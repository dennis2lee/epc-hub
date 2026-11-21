-- M3 red-team fixes (doc/reviews/2026-11-21-m3-redteam.md, decisions D19–D24).

-- ---------------------------------------------------------------------------
-- Payments: void and clearing records, reissue link, digits-only check numbers.
-- A voided number is never used again (D20), so the plain unique key returns.
-- ---------------------------------------------------------------------------
drop index public.payments_check_no_live;
alter table public.payments
  add constraint payments_check_no_key unique (check_no),
  add constraint payments_check_no_digits check (check_no ~ '^[1-9][0-9]{0,9}$') not valid,
  add column voided_by uuid references public.people (id),
  add column voided_at timestamptz,
  add column void_reason text,
  add column replaces_payment_id uuid references public.payments (id),
  add column cleared_by uuid references public.people (id),
  add column cleared_recorded_at timestamptz,
  add column self_cleared boolean not null default false,
  add constraint payments_void_fields check ((status = 'void') = (voided_at is not null));

-- Append-only history of what happened to each check (issue, void, clear, unclear).
create table public.payment_events (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.payments (id),
  kind        text not null check (kind in ('issued', 'voided', 'cleared', 'uncleared')),
  actor_id    uuid not null references public.people (id),
  at          timestamptz not null default now(),
  reason      text,
  cleared_on  date
);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;
grant select on public.payment_events to authenticated;
create policy "finance and auditors read payment events" on public.payment_events
  for select to authenticated
  using ((select private.is_finance_member(private.current_member_id())) or (select private.is_auditor()));
create trigger audit_payment_events after insert or update or delete on public.payment_events
  for each row execute function private.audit_row();

create or replace function private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only';
end
$$;
create trigger payment_events_append_only before update or delete on public.payment_events
  for each row execute function private.forbid_change();

-- Where a return came from (approved or received), for the audit trail.
alter table public.claim_returns add column from_status public.claim_status;

-- Digits only, after Unicode normalization (full-width digits become ASCII).
-- Anything else (letters, '#', spaces inside) is rejected by the caller.
create or replace function private.normalize_check_no(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
           when normalize(trim(coalesce(p, '')), NFKC) ~ '^[0-9]+$'
             then ltrim(normalize(trim(p), NFKC), '0')
           else null
         end
$$;

-- Approvers of the claim's current round (they never handle its money).
create or replace function private.approved_round(p_claim uuid, p_person uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.approval_steps s join public.claims c on c.id = s.claim_id
     where s.claim_id = p_claim and s.round = c.round
       and (s.approver_id = p_person or s.acted_by = p_person)
  )
$$;

-- Whether a person may record bank clearing for a check, ignoring the issuer rule.
create or replace function private.may_reconcile(p_payment uuid, p_person uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_person is not null
     and private.is_finance_member(p_person)
     and not exists (
       select 1 from public.payment_claims pc join public.claims c on c.id = pc.claim_id
        where pc.payment_id = p_payment
          and (c.author_id = p_person or private.approved_round(c.id, p_person))
     )
$$;

-- ---------------------------------------------------------------------------
-- Record a check: digits-only number, typed amount must match (D23), reissue
-- after a void is linked and cannot be dated before the void (D20).
-- ---------------------------------------------------------------------------
drop function public.record_payment(uuid[], text, date, text);
create function public.record_payment(
  p_claims uuid[],
  p_check_no text,
  p_issued_on date,
  p_memo text,
  p_check_amount_cents bigint
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_ids uuid[];
  v_payment uuid;
  v_total bigint := 0;
  v_check text := private.normalize_check_no(p_check_no);
  v_replaces uuid;
  v_void_day date;
  r record;
  v_first record;
begin
  if v_me is null then raise exception 'not_member'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_claims, '{}'::uuid[])) x where x is not null;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 50 then raise exception 'claims_required'; end if;
  if v_check is null or v_check !~ '^[1-9][0-9]{0,9}$' then raise exception 'check_no_invalid'; end if;
  if p_issued_on is null then raise exception 'issued_on_required'; end if;
  if p_issued_on > private.today() then raise exception 'issued_on_in_future'; end if;
  if exists (select 1 from public.payments where check_no = v_check) then
    raise exception 'check_no_taken';
  end if;

  -- Lock all claims in a stable order to avoid deadlocks.
  for r in select * from public.claims where id = any (v_ids) order by id for update loop
    if r.status <> 'received' then raise exception 'stale_or_closed'; end if;
    if not private.can_handle_finance(r.id, v_me) then raise exception 'not_finance'; end if;
    if p_issued_on < private.local_date(r.received_at, private.church_tz()) then
      raise exception 'issued_before_verified';
    end if;
    if v_first is null then
      v_first := r;
    elsif r.author_id <> v_first.author_id or r.payee_name is distinct from v_first.payee_name
          or r.check_delivery <> v_first.check_delivery
          or r.payee_mail_address is distinct from v_first.payee_mail_address then
      raise exception 'one_payee_per_check';
    end if;
    v_total := v_total + r.total_cents;
  end loop;
  if (select count(*) from public.claims where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'not_found';
  end if;
  if p_check_amount_cents is distinct from v_total then raise exception 'amount_mismatch'; end if;

  -- Reissue: link the latest voided check of these claims; no backdating before the void.
  select pm.id, private.local_date(pm.voided_at, private.church_tz())
    into v_replaces, v_void_day
    from public.payments pm join public.payment_claims pc on pc.payment_id = pm.id
   where pc.claim_id = any (v_ids) and pm.status = 'void'
   order by pm.voided_at desc
   limit 1;
  if v_replaces is not null and p_issued_on < v_void_day then raise exception 'issued_before_void'; end if;

  insert into public.payments (check_no, issued_on, amount_cents, payee_name, paid_by, memo, replaces_payment_id)
  values (v_check, p_issued_on, v_total, v_first.payee_name, v_me, left(nullif(trim(p_memo), ''), 300), v_replaces)
  returning id into v_payment;

  insert into public.payment_claims (payment_id, claim_id, amount_cents)
  select v_payment, c.id, c.total_cents from public.claims c where c.id = any (v_ids);

  insert into public.payment_events (payment_id, kind, actor_id) values (v_payment, 'issued', v_me);

  update public.claims set status = 'paid', version = version + 1, updated_at = now() where id = any (v_ids);

  -- One email per check, attached to the first claim.
  perform private.notify(v_first.id, v_first.author_id, 'check_issued');
  return v_payment;
end
$$;

-- ---------------------------------------------------------------------------
-- Void a check (D20): any finance handler of every bundled claim, the issuer
-- included; reason required; the whole check only; claims go back to received.
-- ---------------------------------------------------------------------------
create or replace function public.void_payment(p_payment uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_reason text := trim(coalesce(p_reason, ''));
  pm public.payments%rowtype;
  r record;
begin
  if v_me is null or not private.is_finance_member(v_me) then raise exception 'not_finance'; end if;
  if length(v_reason) < 5 or v_reason = '기타' then raise exception 'reason_required'; end if;
  select * into pm from public.payments where id = p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if pm.status <> 'issued' then raise exception 'stale_or_closed'; end if;

  for r in select c.* from public.claims c join public.payment_claims pc on pc.claim_id = c.id
            where pc.payment_id = p_payment order by c.id for update of c loop
    if r.status <> 'paid' then raise exception 'stale_or_closed'; end if;
    if not private.can_handle_finance(r.id, v_me) then raise exception 'not_finance'; end if;
  end loop;

  update public.payments
     set status = 'void', voided_by = v_me, voided_at = now(), void_reason = left(v_reason, 300)
   where id = p_payment;
  insert into public.payment_events (payment_id, kind, actor_id, reason) values (p_payment, 'voided', v_me, left(v_reason, 300));
  update public.claims c
     set status = 'received', version = version + 1, updated_at = now()
    from public.payment_claims pc
   where pc.payment_id = p_payment and c.id = pc.claim_id;
  perform private.notify(c.id, c.author_id, 'check_voided')
     from public.claims c join public.payment_claims pc on pc.claim_id = c.id
    where pc.payment_id = p_payment
    order by c.claim_no
    limit 1;
end
$$;

-- ---------------------------------------------------------------------------
-- Bank clearing (D21): not the payee, not an approver; the issuer only when
-- nobody else qualifies, and then it is flagged self_cleared.
-- ---------------------------------------------------------------------------
create or replace function public.mark_check_cleared(p_payment uuid, p_cleared_on date)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  pm public.payments%rowtype;
  v_self boolean := false;
begin
  select * into pm from public.payments where id = p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if not private.may_reconcile(p_payment, v_me) then raise exception 'not_finance'; end if;
  if pm.status <> 'issued' then raise exception 'stale_or_closed'; end if;
  if p_cleared_on is null or p_cleared_on < pm.issued_on or p_cleared_on > private.today() then
    raise exception 'bad_cleared_on';
  end if;
  if pm.paid_by = v_me then
    if exists (select 1 from public.people p
                where p.id <> v_me and p.status = 'active' and private.may_reconcile(p_payment, p.id)) then
      raise exception 'issuer_cannot_clear';
    end if;
    v_self := true;
  end if;
  update public.payments
     set status = 'cleared', cleared_on = p_cleared_on, cleared_by = v_me, cleared_recorded_at = now(),
         self_cleared = v_self
   where id = p_payment;
  insert into public.payment_events (payment_id, kind, actor_id, cleared_on) values (p_payment, 'cleared', v_me, p_cleared_on);
end
$$;

-- Correct a wrong clearing record (D21).
create or replace function public.unmark_check_cleared(p_payment uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_reason text := trim(coalesce(p_reason, ''));
  pm public.payments%rowtype;
begin
  if length(v_reason) < 5 or v_reason = '기타' then raise exception 'reason_required'; end if;
  select * into pm from public.payments where id = p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if pm.status <> 'cleared' then raise exception 'stale_or_closed'; end if;
  if not (pm.cleared_by = v_me and private.is_finance_member(v_me)) and not private.may_reconcile(p_payment, v_me) then
    raise exception 'not_finance';
  end if;
  insert into public.payment_events (payment_id, kind, actor_id, reason, cleared_on)
  values (p_payment, 'uncleared', v_me, left(v_reason, 300), pm.cleared_on);
  update public.payments
     set status = 'issued', cleared_on = null, cleared_by = null, cleared_recorded_at = null, self_cleared = false
   where id = p_payment;
end
$$;

-- ---------------------------------------------------------------------------
-- Return for documents is also allowed after verification (D22), not after payment.
-- ---------------------------------------------------------------------------
create or replace function public.return_claim(p_claim uuid, p_version int, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
  v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  if coalesce(trim(p_reason), '') = '' or trim(p_reason) = '기타' then raise exception 'reason_required'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.status not in ('approved', 'received') or c.version is distinct from p_version then
    raise exception 'stale_or_closed';
  end if;
  if not private.can_handle_finance(p_claim, v_me) then raise exception 'not_finance'; end if;
  if exists (select 1 from public.payment_claims pc join public.payments pm on pm.id = pc.payment_id
              where pc.claim_id = p_claim and pm.status <> 'void') then
    raise exception 'stale_or_closed';
  end if;
  insert into public.claim_returns (claim_id, round, returned_by, reason, from_status)
  values (p_claim, c.round, v_me, left(trim(p_reason), 300), c.status);
  update public.claims
     set status = 'rejected', return_reason = left(trim(p_reason), 300),
         received_by = null, received_at = null, dup_note = null,
         version = version + 1, updated_at = now()
   where id = p_claim;
  perform private.notify(p_claim, c.author_id, 'documents_requested');
end
$$;

-- ---------------------------------------------------------------------------
-- Finance and auditors see the check list; per-row flags say what the viewer may do.
-- ---------------------------------------------------------------------------
drop function public.finance_payments(date);
create function public.finance_payments(p_since date)
returns table (payment_id uuid, check_no text, issued_on date, cleared_on date, status public.payment_status,
               amount_cents bigint, payee_name text, claim_nos text, check_delivery text,
               paid_by_name text, cleared_by_name text, self_cleared boolean, voided_by_name text,
               void_reason text, replaces_check_no text, can_clear boolean, can_void boolean, can_unclear boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
begin
  if v_me is null or not (private.is_finance_member(v_me) or private.is_auditor()) then raise exception 'not_finance'; end if;
  return query
    select pm.id, pm.check_no, pm.issued_on, pm.cleared_on, pm.status, pm.amount_cents, pm.payee_name,
           string_agg(c.claim_no, ', ' order by c.claim_no),
           min(c.check_delivery::text),
           (select name from public.people where id = pm.paid_by),
           (select name from public.people where id = pm.cleared_by),
           pm.self_cleared,
           (select name from public.people where id = pm.voided_by),
           pm.void_reason,
           (select o.check_no from public.payments o where o.id = pm.replaces_payment_id),
           pm.status = 'issued' and private.may_reconcile(pm.id, v_me)
             and (pm.paid_by <> v_me or not exists (
                   select 1 from public.people p
                    where p.id <> v_me and p.status = 'active' and private.may_reconcile(pm.id, p.id))),
           pm.status = 'issued' and private.is_finance_member(v_me)
             and bool_and(private.can_handle_finance(c.id, v_me) and c.status = 'paid'),
           pm.status = 'cleared' and ((pm.cleared_by = v_me and private.is_finance_member(v_me)) or private.may_reconcile(pm.id, v_me))
      from public.payments pm
      join public.payment_claims pc on pc.payment_id = pm.id
      join public.claims c on c.id = pc.claim_id
     where pm.status = 'issued' or pm.issued_on >= coalesce(p_since, private.today() - 60)
     group by pm.id
     order by pm.status, pm.issued_on desc;
end
$$;

-- ---------------------------------------------------------------------------
-- Monthly export (D19): one basis only, the check's issue date (cash basis).
-- Every check issued in the month appears, void ones too (number continuity);
-- unpaid claims are in finance_outstanding instead; cancelled claims never.
-- ---------------------------------------------------------------------------
drop function public.finance_export(text);
create function public.finance_export(p_month text)
returns table (check_no text, issued_on date, payment_status public.payment_status, check_amount_cents bigint,
               claim_no text, department text, author text, payee_name text, purpose text, expense_date date,
               amount_cents bigint, cleared_on date, voided_on date, void_reason text, replaces_check_no text,
               approvers text, received_by text, paid_by text, cleared_by text, self_cleared boolean,
               single_approver boolean, solo_admin_period boolean, late boolean, dup_warning boolean, dup_note text,
               returns_count int, backdated boolean)
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_start date;
begin
  if v_me is null or not (private.is_finance_member(v_me) or private.is_auditor()) then
    raise exception 'not_finance';
  end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'bad_month'; end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  -- Downloads are part of the audit trail.
  insert into public.audit_logs (actor_id, action, entity, entity_id, after)
  values (v_me, 'export', 'finance_export', p_month, jsonb_build_object('month', p_month));
  return query
    select pm.check_no, pm.issued_on, pm.status, pm.amount_cents,
           c.claim_no, d.name, a.name, c.payee_name, c.purpose, c.expense_date,
           case when pm.status = 'void' then 0::bigint else pc.amount_cents end,
           pm.cleared_on,
           private.local_date(pm.voided_at, private.church_tz()),
           pm.void_reason,
           (select o.check_no from public.payments o where o.id = pm.replaces_payment_id),
           (select string_agg(coalesce(ap.name, '') || ' ' || to_char(s.decided_at at time zone private.church_tz(), 'MM/DD'),
                              ', ' order by s.seq)
              from public.approval_steps s join public.people ap on ap.id = coalesce(s.acted_by, s.approver_id)
             where s.claim_id = c.id and s.round = c.round and s.decision = 'approve'),
           (select name from public.people where id = c.received_by),
           (select name from public.people where id = pm.paid_by),
           (select name from public.people where id = pm.cleared_by),
           pm.self_cleared,
           c.single_approver, c.solo_admin_period, c.late, c.dup_warning, c.dup_note,
           (select count(*)::int from public.claim_returns cr where cr.claim_id = c.id)
             + (select count(distinct s.round)::int from public.approval_steps s
                 where s.claim_id = c.id and s.decision = 'reject'),
           date_trunc('month', pm.issued_on) < date_trunc('month', pm.created_at at time zone private.church_tz())
      from public.payments pm
      join public.payment_claims pc on pc.payment_id = pm.id
      join public.claims c on c.id = pc.claim_id
      join public.departments d on d.id = c.department_id
      join public.people a on a.id = c.author_id
     where pm.issued_on >= v_start
       and pm.issued_on < (v_start + interval '1 month')::date
     order by length(pm.check_no), pm.check_no, c.claim_no;
end
$$;

-- Approved claims without a live check, and checks not yet cleared (today's view).
create or replace function public.finance_outstanding()
returns table (section text, claim_no text, check_no text, payee_name text, amount_cents bigint,
               since date, days int)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
begin
  if v_me is null or not (private.is_finance_member(v_me) or private.is_auditor()) then
    raise exception 'not_finance';
  end if;
  return query
    select 'unpaid'::text, c.claim_no, null::text, c.payee_name, c.total_cents,
           private.local_date(c.updated_at, private.church_tz()),
           (private.today() - private.local_date(c.updated_at, private.church_tz()))::int
      from public.claims c
     where c.status in ('approved', 'received')
    union all
    select 'uncleared', string_agg(c.claim_no, ', ' order by c.claim_no), pm.check_no, pm.payee_name, pm.amount_cents,
           pm.issued_on, (private.today() - pm.issued_on)::int
      from public.payments pm
      join public.payment_claims pc on pc.payment_id = pm.id
      join public.claims c on c.id = pc.claim_id
     where pm.status = 'issued'
     group by pm.id
    order by 1, 6;
end
$$;

-- ---------------------------------------------------------------------------
-- Print view: an approval counts only if it was given to exactly the content
-- now on the claim (snapshot hash) and the claim is in an approved state.
-- ---------------------------------------------------------------------------
create or replace function public.claim_print_steps(p_claim uuid)
returns table (step_id uuid, seq int, roles text[], decision public.decision_kind, decided_at timestamptz,
               approver_name text, acted_by_name text, valid boolean, snapshot8 text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
  v_hash text;
begin
  if not private.can_read_claim(p_claim) then raise exception 'not_found'; end if;
  select * into c from public.claims where id = p_claim;
  v_hash := private.claim_snapshot_hash(p_claim);
  return query
    select s.id, s.seq, s.roles, s.decision, s.decided_at,
           (select name from public.people where id = s.approver_id),
           case when s.acted_by is not null and s.acted_by <> s.approver_id
                then (select name from public.people where id = s.acted_by) end,
           s.decision = 'approve' and s.snapshot_hash = v_hash
             and c.status in ('in_review', 'approved', 'received', 'paid'),
           left(s.snapshot_hash, 8)
      from public.approval_steps s
     where s.claim_id = p_claim and s.round = c.round
     order by s.seq;
end
$$;

-- ---------------------------------------------------------------------------
-- Daily digest also covers finance work waiting, old uncleared checks and
-- failed notices (same WHERE as stuck_claims plus finance rows).
-- ---------------------------------------------------------------------------
create table public.digest_runs (
  run_date date primary key,
  at       timestamptz not null default now()
);
alter table public.digest_runs enable row level security;
revoke all on public.digest_runs from anon, authenticated;

-- Returns true once per church-local day; the cron sends the digest only then.
create or replace function public.claim_digest_run_srv()
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  insert into public.digest_runs (run_date) values (private.today()) on conflict do nothing;
  return found;
end
$$;

create or replace function public.old_checks_srv(p_days int)
returns table (check_no text, payee_name text, amount_cents bigint, days int)
language sql stable security definer
set search_path = ''
as $$
  select pm.check_no, pm.payee_name, pm.amount_cents, (private.today() - pm.issued_on)::int
    from public.payments pm
   where pm.status = 'issued' and private.today() - pm.issued_on >= p_days
   order by pm.issued_on
$$;

-- Finance members and finance elders get the finance part of the digest.
create or replace function public.finance_emails_srv()
returns table (email text)
language sql stable security definer
set search_path = ''
as $$
  select distinct p.email
    from public.people p
   where p.status = 'active' and p.email is not null and private.is_finance_member(p.id)
$$;

-- ---------------------------------------------------------------------------
-- me(): expose the same finance predicate the database uses.
-- ---------------------------------------------------------------------------
create or replace function public.me_finance()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_finance_member', coalesce(private.is_finance_member(private.current_member_id()), false),
    'is_auditor', coalesce(private.is_auditor(), false),
    'holds_finance_role', coalesce(
      private.holds_role(private.current_member_id(), 'finance', private.today())
      or private.holds_role(private.current_member_id(), 'finance_elder', private.today()), false)
  )
$$;

-- ---------------------------------------------------------------------------
-- Privileges.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
revoke execute on function private.approved_round(uuid, uuid), private.may_reconcile(uuid, uuid),
  private.forbid_change() from authenticated;
revoke execute on function public.claim_digest_run_srv(), public.old_checks_srv(int), public.finance_emails_srv()
  from authenticated;
grant execute on function public.claim_digest_run_srv(), public.old_checks_srv(int), public.finance_emails_srv()
  to service_role;
grant execute on function
  public.record_payment(uuid[], text, date, text, bigint),
  public.void_payment(uuid, text),
  public.mark_check_cleared(uuid, date),
  public.unmark_check_cleared(uuid, text),
  public.return_claim(uuid, int, text),
  public.finance_payments(date),
  public.finance_export(text),
  public.finance_outstanding(),
  public.claim_print_steps(uuid),
  public.me_finance()
to authenticated;

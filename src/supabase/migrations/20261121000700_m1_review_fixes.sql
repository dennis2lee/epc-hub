-- M1 red-team fixes (doc/reviews/2026-11-21-m1-redteam.md). Business-rule
-- corrections; security hardening follows in the next migration.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------
alter table public.people
  add column in_person_checked_at timestamptz;

alter table public.claims
  add column payee_name text,
  add column payee_mail_address text,
  add column first_submitted_at timestamptz,
  add column blocked_reason text,
  add column blocked_at timestamptz;

-- The same file twice in one claim is always a mistake.
alter table public.attachments
  add constraint attachments_claim_sha_unique unique (claim_id, sha256);

-- Which other claims look like duplicates (shown to finance).
create table public.claim_duplicates (
  claim_id        uuid not null references public.claims (id) on delete cascade,
  other_claim_id  uuid not null references public.claims (id) on delete cascade,
  reason          text not null check (reason in ('same_file', 'same_receipt')),
  primary key (claim_id, other_claim_id, reason)
);
alter table public.claim_duplicates enable row level security;
create policy "read duplicates of readable claims" on public.claim_duplicates
  for select to authenticated using ((select private.can_read_claim(claim_id)));
revoke insert, update, delete, truncate on public.claim_duplicates from anon, authenticated;

-- Finance returns for documents, kept per round (the claim keeps only the latest).
create table public.claim_returns (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims (id) on delete cascade,
  round       int not null,
  returned_by uuid not null references public.people (id),
  reason      text not null,
  at          timestamptz not null default now()
);
alter table public.claim_returns enable row level security;
create policy "read returns of readable claims" on public.claim_returns
  for select to authenticated using ((select private.can_read_claim(claim_id)));
revoke insert, update, delete, truncate on public.claim_returns from anon, authenticated;

alter table public.claims add column dup_note text;

-- Checks: numbers are unique among non-void checks; void numbers may be reissued.
alter table public.payments drop constraint payments_check_no_key;
create unique index payments_check_no_live on public.payments (check_no) where status <> 'void';

create trigger audit_claim_returns after insert or update or delete on public.claim_returns
  for each row execute function private.audit_row();
create trigger audit_claim_duplicates after insert or update or delete on public.claim_duplicates
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- A person may act in approval or finance roles only when active and, if the
-- role requires it, confirmed in person (decision D12).
create or replace function private.is_cleared(p_person uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.people p
     where p.id = p_person
       and p.status = 'active'
       and (not p.needs_in_person_check or p.in_person_checked_at is not null)
  )
$$;

-- Drafts may be prepared while the account is still pending (design §8).
create or replace function private.current_drafter_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id
    from public.person_logins l
    join public.people p on p.id = l.person_id
   where l.auth_user_id = (select auth.uid())
     and p.status in ('active', 'pending')
$$;

create or replace function private.can_edit_claim(p_claim uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.claims c
     where c.id = p_claim
       and c.status = 'draft'
       and c.author_id = private.current_drafter_id()
  )
$$;

-- Approval line. Fixes: a merged step (head = elder) ended with an exception
-- because RETURN QUERY does not leave the function; approvers must be cleared.
create or replace function private.build_line(p_dept uuid, p_author uuid, p_on date)
returns table (seq int, roles text[], approver_id uuid)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_head uuid := private.dept_head_of(p_dept, p_on);
  v_elder uuid := private.elder_of(p_dept, p_on);
begin
  if v_head is null then raise exception 'no_dept_head'; end if;
  if v_elder is null then raise exception 'no_elder'; end if;

  if v_head = v_elder then
    if v_head = p_author then raise exception 'no_independent_approver'; end if;
    if not private.is_cleared(v_head) then raise exception 'approver_not_active'; end if;
    return query select 1, array['dept_head', 'elder'], v_head;
    return;
  end if;

  if v_head = p_author then
    if not private.is_cleared(v_elder) then raise exception 'approver_not_active'; end if;
    return query select 1, array['elder'], v_elder;            -- A6
    return;
  end if;
  if v_elder = p_author then
    if not private.is_cleared(v_head) then raise exception 'approver_not_active'; end if;
    return query select 1, array['dept_head'], v_head;         -- A7
    return;
  end if;

  if not private.is_cleared(v_head) or not private.is_cleared(v_elder) then
    raise exception 'approver_not_active';
  end if;
  return query select 1, array['dept_head'], v_head
               union all
               select 2, array['elder'], v_elder;
end
$$;

-- Who may verify and pay a claim (decision D13, provisional):
--   * never the author, and never someone who approved it in the current round;
--   * any cleared finance member otherwise;
--   * a cleared finance elder only when no such finance member exists (A9 and
--     the case where the only finance member is the author or an approver).
create or replace function private.can_handle_finance(p_claim uuid, p_person uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
  v_today date := private.today();
  v_other_finance boolean;
begin
  if p_person is null then return false; end if;
  select * into c from public.claims where id = p_claim;
  if not found or c.author_id = p_person then return false; end if;
  if exists (select 1 from public.approval_steps s
              where s.claim_id = p_claim and s.round = c.round
                and (s.approver_id = p_person or s.acted_by = p_person)) then
    return false;
  end if;
  if not private.is_cleared(p_person) then return false; end if;
  if private.holds_role(p_person, 'finance', v_today) then return true; end if;
  if not private.holds_role(p_person, 'finance_elder', v_today) then return false; end if;

  select exists (
    select 1 from public.positions ps
     where ps.role = 'finance'
       and ps.person_id <> c.author_id
       and ps.starts_on <= v_today and (ps.ends_on is null or ps.ends_on >= v_today)
       and private.is_cleared(ps.person_id)
       and not exists (select 1 from public.approval_steps s
                        where s.claim_id = p_claim and s.round = c.round
                          and (s.approver_id = ps.person_id or s.acted_by = ps.person_id))
  ) into v_other_finance;
  return not v_other_finance;
end
$$;

-- Snapshot now also covers the payee fixed at submission.
create or replace function private.claim_snapshot_hash(p_claim uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'claim', (select jsonb_build_object(
                      'id', c.id, 'department_id', c.department_id, 'purpose', c.purpose,
                      'attendees', c.attendees, 'expense_date', c.expense_date,
                      'total_cents', c.total_cents, 'check_delivery', c.check_delivery,
                      'payee_name', c.payee_name, 'payee_mail_address', c.payee_mail_address)
                      from public.claims c where c.id = p_claim),
          'lines', coalesce((select jsonb_agg(jsonb_build_object(
                      'description', l.description, 'amount_cents', l.amount_cents,
                      'budget_code', l.budget_code) order by l.sort_order, l.id)
                      from public.claim_lines l where l.claim_id = p_claim), '[]'::jsonb),
          'attachments', coalesce((select jsonb_agg(a.sha256 order by a.sha256)
                      from public.attachments a where a.claim_id = p_claim), '[]'::jsonb)
        )::text,
        'UTF8'),
      'sha256'),
    'hex')
$$;

-- Normalize a check number: trim; purely numeric numbers lose leading zeros.
create or replace function private.normalize_check_no(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select case when trim(p) ~ '^[0-9]+$' then ltrim(trim(p), '0') else upper(trim(p)) end
$$;

-- ---------------------------------------------------------------------------
-- Drafts (pending accounts may prepare drafts)
-- ---------------------------------------------------------------------------
create or replace function public.create_claim(p_department uuid)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_drafter_id();
  v_id uuid;
begin
  if v_me is null then raise exception 'not_member'; end if;
  if not exists (select 1 from public.departments d where d.id = p_department and d.active) then
    raise exception 'bad_department';
  end if;
  insert into public.claims (author_id, department_id) values (v_me, p_department)
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.save_claim_draft(
  p_claim uuid,
  p_version int,
  p_department uuid,
  p_purpose text,
  p_attendees text,
  p_expense_date date,
  p_check_delivery public.check_delivery,
  p_lines jsonb
)
returns int
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_drafter_id();
  c public.claims%rowtype;
  v_line jsonb;
  v_i int := 0;
  v_total bigint := 0;
  v_amount bigint;
begin
  if v_me is null then raise exception 'not_member'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id <> v_me then raise exception 'not_author'; end if;
  if c.status <> 'draft' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if p_check_delivery is null then raise exception 'bad_delivery'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 30 then
    raise exception 'bad_lines';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_department and d.active) then
    raise exception 'bad_department';
  end if;

  delete from public.claim_lines where claim_id = p_claim;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if jsonb_typeof(v_line -> 'amount_cents') <> 'number' then raise exception 'bad_amount'; end if;
    begin
      v_amount := (v_line ->> 'amount_cents')::bigint;
    exception when others then
      raise exception 'bad_amount';
    end;
    if v_amount is null or v_amount <= 0 or v_amount > 100000000 then raise exception 'bad_amount'; end if;
    if coalesce(trim(v_line ->> 'description'), '') = '' or length(v_line ->> 'description') > 200 then
      raise exception 'bad_lines';
    end if;
    insert into public.claim_lines (claim_id, description, amount_cents, budget_code, sort_order)
    values (p_claim, trim(v_line ->> 'description'), v_amount,
            left(nullif(trim(v_line ->> 'budget_code'), ''), 40), v_i);
    v_i := v_i + 1;
    v_total := v_total + v_amount;
  end loop;

  update public.claims
     set department_id = p_department,
         purpose = left(coalesce(trim(p_purpose), ''), 300),
         attendees = left(nullif(trim(p_attendees), ''), 300),
         expense_date = p_expense_date,
         check_delivery = p_check_delivery,
         total_cents = v_total,
         version = version + 1,
         updated_at = now()
   where id = p_claim;
  return c.version + 1;
end
$$;

create or replace function public.add_attachment(
  p_claim uuid,
  p_storage_path text,
  p_mime text,
  p_bytes bigint,
  p_sha256 text,
  p_merchant text,
  p_receipt_date date,
  p_amount_cents bigint
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.can_edit_claim(p_claim) then raise exception 'stale_or_closed'; end if;
  if split_part(p_storage_path, '/', 1) <> p_claim::text then raise exception 'bad_path'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad_hash'; end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') then
    raise exception 'bad_type';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = p_storage_path) then
    raise exception 'missing_object';
  end if;
  if exists (select 1 from public.attachments a where a.claim_id = p_claim and a.sha256 = p_sha256) then
    raise exception 'duplicate_receipt';
  end if;
  insert into public.attachments (claim_id, storage_path, mime, bytes, sha256, merchant, receipt_date, amount_cents)
  values (p_claim, p_storage_path, p_mime, p_bytes, p_sha256, left(nullif(trim(p_merchant), ''), 100),
          p_receipt_date, p_amount_cents)
  returning id into v_id;
  update public.claims set version = version + 1, updated_at = now() where id = p_claim;
  return v_id;
end
$$;

create or replace function public.delete_draft(p_claim uuid, p_version int)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id is distinct from private.current_drafter_id() then raise exception 'not_author'; end if;
  if c.status <> 'draft' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  -- A numbered claim keeps its number; it can be cancelled instead.
  if c.claim_no is not null then raise exception 'has_claim_no'; end if;
  update public.claims set status = 'deleted', version = version + 1, updated_at = now() where id = p_claim;
end
$$;

-- The author gives up a numbered claim (draft after withdrawal or a returned claim).
create or replace function public.cancel_own_claim(p_claim uuid, p_version int, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id is distinct from private.current_drafter_id() then raise exception 'not_author'; end if;
  if c.status not in ('draft', 'rejected') or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if c.claim_no is null then raise exception 'use_delete'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  update public.claims
     set status = 'cancelled', return_reason = left(trim(p_reason), 300), version = version + 1, updated_at = now()
   where id = p_claim;
end
$$;

-- When submit is blocked by the organization (no head, approver not cleared),
-- the author's screen reports it so the office sees it on the stuck list.
create or replace function public.report_blocked_submit(p_claim uuid, p_code text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_code not in ('no_dept_head', 'no_elder', 'approver_not_active', 'no_independent_approver') then
    raise exception 'bad_code';
  end if;
  update public.claims
     set blocked_reason = p_code, blocked_at = now()
   where id = p_claim and status = 'draft' and author_id = private.current_drafter_id();
end
$$;

-- ---------------------------------------------------------------------------
-- Submit / withdraw
-- ---------------------------------------------------------------------------
create or replace function public.submit_claim(p_claim uuid, p_version int)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  c public.claims%rowtype;
  p public.people%rowtype;
  v_today date := private.today();
  v_total bigint;
  v_round int;
  v_year int;
  v_no int;
  v_steps int;
  v_first uuid;
  v_dup boolean;
  v_late boolean;
  v_first_submit timestamptz;
begin
  if v_me is null then raise exception 'not_member'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id <> v_me then raise exception 'not_author'; end if;
  if c.status <> 'draft' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if not exists (select 1 from public.departments d where d.id = c.department_id and d.active) then
    raise exception 'bad_department';
  end if;

  if coalesce(trim(c.purpose), '') = '' then raise exception 'purpose_required'; end if;
  if c.expense_date is null then raise exception 'expense_date_required'; end if;
  -- One day of slack for receipts dated in an earlier time zone (e.g. Korea).
  if c.expense_date > v_today + 1 then raise exception 'expense_date_in_future'; end if;
  select coalesce(sum(amount_cents), 0) into v_total from public.claim_lines where claim_id = p_claim;
  if v_total <= 0 then raise exception 'lines_required'; end if;
  if v_total <> c.total_cents then raise exception 'total_mismatch'; end if;
  -- Every recorded receipt must still exist as a file (defined in the next migration).
  if not private.receipts_present(p_claim) then raise exception 'receipt_required'; end if;

  -- The check payee is fixed at submission and covered by the approval hash.
  select * into p from public.people where id = v_me;
  if coalesce(trim(p.legal_name_en), '') = '' then raise exception 'legal_name_required'; end if;
  if c.check_delivery = 'mail' and coalesce(trim(p.mail_address), '') = '' then
    raise exception 'mail_address_required';
  end if;

  v_round := c.round + 1;
  insert into public.approval_steps (claim_id, round, seq, roles, approver_id)
  select p_claim, v_round, l.seq, l.roles, l.approver_id
    from private.build_line(c.department_id, v_me, v_today) l;
  get diagnostics v_steps = row_count;

  select approver_id into v_first
    from public.approval_steps where claim_id = p_claim and round = v_round and seq = 1;

  -- Possible duplicates among other live (submitted) claims.
  delete from public.claim_duplicates where claim_id = p_claim;
  insert into public.claim_duplicates (claim_id, other_claim_id, reason)
  select distinct p_claim, b.claim_id,
         case when b.sha256 = a.sha256 then 'same_file' else 'same_receipt' end
    from public.attachments a
    join public.attachments b on b.claim_id <> a.claim_id
     and (b.sha256 = a.sha256
          or (a.merchant is not null and lower(trim(b.merchant)) = lower(trim(a.merchant))
              and b.receipt_date = a.receipt_date and b.amount_cents = a.amount_cents))
    join public.claims oc on oc.id = b.claim_id
     and oc.status in ('in_review', 'approved', 'received', 'paid')
   where a.claim_id = p_claim
  on conflict do nothing;
  v_dup := exists (select 1 from public.claim_duplicates where claim_id = p_claim);

  -- Lateness is judged by the first submission (accountable plan), not resubmissions.
  v_first_submit := coalesce(c.first_submitted_at, now());
  v_late := (private.local_date(v_first_submit, private.church_tz()) - c.expense_date)
            > private.setting_int('late_days', 60);

  if c.claim_no is null then
    v_year := extract(year from v_today)::int;
    insert into public.claim_counters (year, last_no) values (v_year, 1)
      on conflict (year) do update set last_no = public.claim_counters.last_no + 1
      returning last_no into v_no;
  end if;

  update public.claims
     set status = 'in_review',
         round = v_round,
         current_seq = 1,
         single_approver = (v_steps = 1),
         dup_warning = v_dup,
         dup_note = null,
         late = v_late,
         return_reason = null,
         blocked_reason = null,
         blocked_at = null,
         payee_name = trim(p.legal_name_en),
         payee_mail_address = case when c.check_delivery = 'mail' then trim(p.mail_address) end,
         claim_no = coalesce(c.claim_no, v_year::text || '-' || lpad(v_no::text, 4, '0')),
         first_submitted_at = v_first_submit,
         submitted_at = now(),
         version = version + 1,
         updated_at = now()
   where id = p_claim;

  perform private.notify(p_claim, v_first, 'review_requested');

  return jsonb_build_object('status', 'in_review', 'steps', v_steps,
                            'duplicate_warning', v_dup, 'late', v_late);
end
$$;

create or replace function public.withdraw_claim(p_claim uuid, p_version int)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
begin
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id is distinct from private.current_member_id() then raise exception 'not_author'; end if;
  if c.status <> 'in_review' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if exists (select 1 from public.approval_steps s
              where s.claim_id = p_claim and s.round = c.round and s.decision is not null) then
    raise exception 'already_approved';
  end if;
  delete from public.approval_steps where claim_id = p_claim and round = c.round;
  -- Do not email a review request for a claim that was taken back.
  update public.notifications set status = 'skipped'
   where claim_id = p_claim and status = 'pending' and kind = 'review_requested';
  update public.claims
     set status = 'draft', round = c.round - 1, current_seq = 0, version = version + 1, updated_at = now()
   where id = p_claim;
end
$$;

-- ---------------------------------------------------------------------------
-- Approve / request changes
-- ---------------------------------------------------------------------------
create or replace function public.act_on_claim(
  p_claim uuid,
  p_decision public.decision_kind,
  p_reason text,
  p_version int,
  p_client jsonb
)
returns public.claim_status
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c  public.claims%rowtype;
  s  public.approval_steps%rowtype;
  v_me uuid := private.current_member_id();
  v_next uuid;
  v_status public.claim_status;
  v_handlers int;
begin
  if v_me is null then raise exception 'not_member'; end if;
  if p_decision is null then raise exception 'bad_decision'; end if;

  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.status <> 'in_review' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if v_me = c.author_id then raise exception 'author_cannot_act'; end if;

  select * into s from public.approval_steps
   where claim_id = p_claim and round = c.round and seq = c.current_seq;
  if not found or s.decision is not null then raise exception 'no_open_step'; end if;
  if s.approver_id is distinct from v_me then raise exception 'not_your_turn'; end if;
  if not private.is_cleared(v_me) then raise exception 'not_cleared'; end if;
  if exists (select 1 from public.approval_steps
              where claim_id = p_claim and round = c.round and acted_by = v_me) then
    raise exception 'already_acted_on_claim';
  end if;
  if p_decision = 'reject'
     and (coalesce(trim(p_reason), '') = '' or trim(p_reason) = '기타') then
    raise exception 'reason_required';
  end if;

  update public.approval_steps
     set decision = p_decision,
         reason = left(nullif(trim(p_reason), ''), 300),
         acted_by = v_me,
         decided_at = now(),
         snapshot_hash = private.claim_snapshot_hash(p_claim),
         client_info = case when jsonb_typeof(p_client) = 'object' and length(p_client::text) < 2000
                            then p_client end
   where id = s.id;

  if p_decision = 'reject' then
    v_status := 'rejected';
    update public.claims set status = v_status, version = version + 1, updated_at = now() where id = p_claim;
    perform private.notify(p_claim, c.author_id, 'changes_requested');
  else
    select approver_id into v_next from public.approval_steps
     where claim_id = p_claim and round = c.round and seq = c.current_seq + 1;
    if found then
      v_status := 'in_review';
      update public.claims set current_seq = current_seq + 1, version = version + 1, updated_at = now()
       where id = p_claim;
      perform private.notify(p_claim, v_next, 'review_requested');
    else
      v_status := 'approved';
      update public.claims set status = v_status, version = version + 1, updated_at = now() where id = p_claim;
      perform private.notify(p_claim, c.author_id, 'approved_all');
      perform private.notify(p_claim, h.person_id, 'finance_requested')
         from (select distinct pos.person_id
                 from public.positions pos
                where pos.role in ('finance', 'finance_elder')
                  and pos.starts_on <= private.today()
                  and (pos.ends_on is null or pos.ends_on >= private.today())) h
        where private.can_handle_finance(p_claim, h.person_id);
      get diagnostics v_handlers = row_count;
      if v_handlers = 0 then
        update public.claims set blocked_reason = 'no_finance_handler', blocked_at = now() where id = p_claim;
      end if;
    end if;
    perform private.notify(p_claim, v_me, 'you_approved');
  end if;

  return v_status;
end
$$;

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
drop function public.receive_claim(uuid, int);
create or replace function public.receive_claim(p_claim uuid, p_version int, p_dup_note text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
  v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.status <> 'approved' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if not private.can_handle_finance(p_claim, v_me) then raise exception 'not_finance'; end if;
  if c.dup_warning and coalesce(trim(p_dup_note), '') = '' then raise exception 'dup_note_required'; end if;
  update public.claims
     set status = 'received', received_by = v_me, received_at = now(),
         dup_note = left(nullif(trim(p_dup_note), ''), 300),
         blocked_reason = null, blocked_at = null,
         version = version + 1, updated_at = now()
   where id = p_claim;
  perform private.notify(p_claim, c.author_id, 'documents_verified');
end
$$;

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
  if c.status <> 'approved' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if not private.can_handle_finance(p_claim, v_me) then raise exception 'not_finance'; end if;
  insert into public.claim_returns (claim_id, round, returned_by, reason)
  values (p_claim, c.round, v_me, left(trim(p_reason), 300));
  update public.claims
     set status = 'rejected', return_reason = left(trim(p_reason), 300), version = version + 1, updated_at = now()
   where id = p_claim;
  perform private.notify(p_claim, c.author_id, 'documents_requested');
end
$$;

-- One check pays one or more verified claims of the same payee and delivery.
create or replace function public.record_payment(
  p_claims uuid[],
  p_check_no text,
  p_issued_on date,
  p_memo text
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
  r record;
  v_first record;
begin
  if v_me is null then raise exception 'not_member'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_claims, '{}'::uuid[])) x where x is not null;
  if v_ids is null or cardinality(v_ids) = 0 or cardinality(v_ids) > 50 then raise exception 'claims_required'; end if;
  if coalesce(v_check, '') = '' or length(v_check) > 20 then raise exception 'check_no_required'; end if;
  if p_issued_on is null then raise exception 'issued_on_required'; end if;
  if p_issued_on > private.today() then raise exception 'issued_on_in_future'; end if;
  if exists (select 1 from public.payments where check_no = v_check and status <> 'void') then
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

  insert into public.payments (check_no, issued_on, amount_cents, payee_name, paid_by, memo)
  values (v_check, p_issued_on, v_total, v_first.payee_name, v_me, left(nullif(trim(p_memo), ''), 300))
  returning id into v_payment;

  insert into public.payment_claims (payment_id, claim_id, amount_cents)
  select v_payment, c.id, c.total_cents from public.claims c where c.id = any (v_ids);

  update public.claims set status = 'paid', version = version + 1, updated_at = now() where id = any (v_ids);

  -- One email per check, attached to the first claim.
  perform private.notify(v_first.id, v_first.author_id, 'check_issued');
  return v_payment;
end
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create or replace function public.admin_confirm_in_person(p_person uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if not exists (select 1 from public.person_logins where person_id = p_person) then raise exception 'not_linked'; end if;
  update public.people
     set in_person_checked_at = now(),
         status = case when status in ('pending', 'invited') then 'active'::public.person_status else status end
   where id = p_person;
  if not found then raise exception 'not_found'; end if;
end
$$;

create or replace function public.admin_assign_position(
  p_person uuid,
  p_department uuid,
  p_role text,
  p_starts_on date,
  p_ends_on date
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if p_role in ('finance', 'finance_elder')
     and not exists (select 1 from public.departments d where d.id = p_department and d.is_finance) then
    raise exception 'finance_role_needs_finance_department';
  end if;
  insert into public.positions (person_id, department_id, role, starts_on, ends_on)
  values (p_person, p_department, p_role, p_starts_on, p_ends_on)
  returning id into v_id;
  -- Approval and finance roles require an in-person check before they count
  -- (private.is_cleared); an already-active member keeps writing claims.
  update public.people set needs_in_person_check = true where id = p_person;
  return v_id;
end
$$;

-- Move the open step to whoever holds that role today (approver left, ill, etc.).
create or replace function public.admin_reassign_current_step(p_claim uuid, p_version int, p_reason text)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c public.claims%rowtype;
  s public.approval_steps%rowtype;
  v_new uuid;
begin
  perform private.require_admin();
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.status <> 'in_review' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  select * into s from public.approval_steps where claim_id = p_claim and round = c.round and seq = c.current_seq;
  if not found or s.decision is not null then raise exception 'no_open_step'; end if;

  v_new := case when 'dept_head' = any (s.roles) then private.dept_head_of(c.department_id, private.today())
                else private.elder_of(c.department_id, private.today()) end;
  if v_new is null or v_new = s.approver_id then raise exception 'no_new_approver'; end if;
  if v_new = c.author_id then raise exception 'no_independent_approver'; end if;
  if exists (select 1 from public.approval_steps x
              where x.claim_id = p_claim and x.round = c.round and x.approver_id = v_new) then
    raise exception 'no_independent_approver';
  end if;
  if not private.is_cleared(v_new) then raise exception 'approver_not_active'; end if;

  update public.approval_steps set approver_id = v_new where id = s.id;
  update public.claims set version = version + 1, updated_at = now() where id = p_claim;
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, after)
  values (private.current_member_id(), (select auth.uid()), 'reassign', 'approval_steps', s.id::text,
          jsonb_build_object('from', s.approver_id, 'to', v_new, 'reason', left(trim(p_reason), 300)));
  perform private.notify(p_claim, v_new, 'review_requested');
  return v_new;
end
$$;

-- Admin stuck list: metadata only; includes drafts blocked by the organization,
-- steps whose approver is no longer cleared, and claims nobody in finance can take.
drop function public.stuck_claims();
create or replace function public.stuck_claims()
returns table (claim_id uuid, claim_no text, department text, status public.claim_status,
               waiting_on text, problem text, days_waiting int, version int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select c.id, c.claim_no, d.name, c.status,
           case when c.status = 'in_review' then p.name else null end,
           case
             when c.blocked_reason is not null then c.blocked_reason
             when c.status = 'in_review' and not private.is_cleared(s.approver_id) then 'approver_not_active'
             else 'waiting'
           end,
           (private.today() - private.local_date(coalesce(c.blocked_at, c.updated_at), private.church_tz()))::int,
           c.version
      from public.claims c
      join public.departments d on d.id = c.department_id
      left join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
      left join public.people p on p.id = s.approver_id
     where (c.status in ('in_review', 'approved', 'received')
            and ((private.today() - private.local_date(c.updated_at, private.church_tz())) >= private.setting_int('stuck_days', 2)
                 or c.blocked_reason is not null
                 or (c.status = 'in_review' and not private.is_cleared(s.approver_id))))
        or (c.status = 'draft' and c.blocked_reason is not null)
     order by coalesce(c.blocked_at, c.updated_at);
end
$$;

-- Function privileges for the new and replaced functions.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
revoke execute on function private.current_drafter_id(), private.is_cleared(uuid),
  private.normalize_check_no(text) from authenticated;
grant execute on function private.can_edit_claim(uuid) to authenticated;
grant execute on function
  public.cancel_own_claim(uuid, int, text),
  public.report_blocked_submit(uuid, text),
  public.receive_claim(uuid, int, text),
  public.stuck_claims(),
  public.admin_confirm_in_person(uuid),
  public.admin_reassign_current_step(uuid, int, text)
to authenticated;

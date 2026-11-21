-- M3: finance screens, check clearing, monthly export, daily stuck digest.

-- Whether the current member may verify / pay this claim (drives the finance panel).
create or replace function public.can_i_handle_finance(p_claim uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_handle_finance(p_claim, private.current_member_id())
$$;

create or replace function private.is_finance_member(p_person uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_cleared(p_person)
     and (private.holds_role(p_person, 'finance', private.today())
          or private.holds_role(p_person, 'finance_elder', private.today()))
$$;

-- Record that the bank cleared a check (reconciliation; design §9).
create or replace function public.mark_check_cleared(p_payment uuid, p_cleared_on date)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  pm public.payments%rowtype;
begin
  if v_me is null or not private.is_finance_member(v_me) then raise exception 'not_finance'; end if;
  select * into pm from public.payments where id = p_payment for update;
  if not found then raise exception 'not_found'; end if;
  if pm.status <> 'issued' then raise exception 'stale_or_closed'; end if;
  if p_cleared_on is null or p_cleared_on < pm.issued_on or p_cleared_on > private.today() then
    raise exception 'bad_cleared_on';
  end if;
  -- The payee of the check never records its clearing.
  if exists (select 1 from public.payment_claims pc join public.claims c on c.id = pc.claim_id
              where pc.payment_id = p_payment and c.author_id = v_me) then
    raise exception 'not_finance';
  end if;
  update public.payments set status = 'cleared', cleared_on = p_cleared_on where id = p_payment;
end
$$;

-- Checks for the finance screen (issued and recently cleared).
create or replace function public.finance_payments(p_since date)
returns table (payment_id uuid, check_no text, issued_on date, cleared_on date, status public.payment_status,
               amount_cents bigint, payee_name text, claim_nos text, check_delivery text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.is_finance_member(private.current_member_id()) then raise exception 'not_finance'; end if;
  return query
    select pm.id, pm.check_no, pm.issued_on, pm.cleared_on, pm.status, pm.amount_cents, pm.payee_name,
           string_agg(c.claim_no, ', ' order by c.claim_no),
           min(c.check_delivery::text)
      from public.payments pm
      join public.payment_claims pc on pc.payment_id = pm.id
      join public.claims c on c.id = pc.claim_id
     where pm.status = 'issued' or pm.issued_on >= coalesce(p_since, private.today() - 60)
     group by pm.id
     order by pm.status, pm.issued_on desc;
end
$$;

-- Monthly export for the church's accounting program (finance and auditors).
create or replace function public.finance_export(p_month text)
returns table (claim_no text, department text, author text, payee_name text, purpose text,
               expense_date date, amount_cents bigint, check_no text, issued_on date, cleared_on date,
               status public.claim_status, single_approver boolean, solo_admin_period boolean, late boolean)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_start date;
begin
  if v_me is null or not (private.is_finance_member(v_me) or private.has_grant(v_me, 'auditor')) then
    raise exception 'not_finance';
  end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_month'; end if;
  v_start := to_date(p_month || '-01', 'YYYY-MM-DD');
  -- A claim belongs to the month its check was issued; unpaid claims by expense date.
  return query
    select c.claim_no, d.name, a.name, c.payee_name, c.purpose, c.expense_date, c.total_cents,
           pm.check_no, pm.issued_on, pm.cleared_on, c.status, c.single_approver, c.solo_admin_period, c.late
      from public.claims c
      join public.departments d on d.id = c.department_id
      join public.people a on a.id = c.author_id
      left join public.payment_claims pc on pc.claim_id = c.id
      left join public.payments pm on pm.id = pc.payment_id and pm.status <> 'void'
     where c.status in ('approved', 'received', 'paid', 'cancelled')
       and coalesce(pm.issued_on, c.expense_date) >= v_start
       and coalesce(pm.issued_on, c.expense_date) < (v_start + interval '1 month')::date
     order by coalesce(pm.issued_on, c.expense_date), c.claim_no;
end
$$;

-- Daily digest for the office (server only, service role).
create or replace function public.stuck_digest_srv()
returns table (claim_no text, department text, problem text, days_waiting int)
language sql stable security definer
set search_path = ''
as $$
  select c.claim_no, d.name,
         coalesce(c.blocked_reason,
                  case when c.status = 'in_review' and not private.is_cleared(s.approver_id) then 'approver_not_active'
                       else 'waiting' end),
         (private.today() - private.local_date(coalesce(c.blocked_at, c.updated_at), private.church_tz()))::int
    from public.claims c
    join public.departments d on d.id = c.department_id
    left join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
   where (c.status in ('in_review', 'approved', 'received')
          and ((private.today() - private.local_date(c.updated_at, private.church_tz())) >= private.setting_int('stuck_days', 2)
               or c.blocked_reason is not null))
      or (c.status = 'draft' and c.blocked_reason is not null)
   order by 4 desc
$$;

create or replace function public.admin_emails_srv()
returns table (email text)
language sql stable security definer
set search_path = ''
as $$
  select distinct p.email
    from public.admin_grants g join public.people p on p.id = g.person_id
   where g.grant_kind = 'admin' and g.revoked_at is null and p.status = 'active' and p.email is not null
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
revoke execute on function public.stuck_digest_srv(), public.admin_emails_srv() from authenticated;
grant execute on function public.stuck_digest_srv(), public.admin_emails_srv() to service_role;
grant execute on function public.can_i_handle_finance(uuid), public.mark_check_cleared(uuid, date),
  public.finance_payments(date), public.finance_export(text) to authenticated;

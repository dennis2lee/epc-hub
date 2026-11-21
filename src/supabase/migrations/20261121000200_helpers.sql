-- Private helper functions. They are SECURITY DEFINER so RLS policies can call
-- them without recursion, and they live in the private schema so the API never
-- exposes them. auth.uid() is read in exactly one place: current_member_id().

-- Church-local calendar date of an instant (pure, testable without faking now()).
create or replace function private.local_date(p_at timestamptz, p_tz text)
returns date
language sql immutable
set search_path = ''
as $$
  select (p_at at time zone p_tz)::date
$$;

create or replace function private.church_tz()
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'time_zone'), 'America/Los_Angeles')
$$;

create or replace function private.today()
returns date
language sql stable security definer
set search_path = ''
as $$
  select private.local_date(now(), private.church_tz())
$$;

create or replace function private.setting_int(p_key text, p_default int)
returns int
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default)
$$;

-- The active person behind the current login, or NULL.
create or replace function private.current_member_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.id
    from public.person_logins l
    join public.people p on p.id = l.person_id
   where l.auth_user_id = (select auth.uid())
     and p.status = 'active'
$$;

-- The person linked to the current login regardless of status (for pending screens).
create or replace function private.current_person_any()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select l.person_id from public.person_logins l where l.auth_user_id = (select auth.uid())
$$;

create or replace function private.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.current_member_id() is not null
$$;

create or replace function private.has_grant(p_person uuid, p_kind text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_grants g
     where g.person_id = p_person and g.grant_kind = p_kind and g.revoked_at is null
  )
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_grant(private.current_member_id(), 'admin')
$$;

create or replace function private.is_auditor()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.has_grant(private.current_member_id(), 'auditor')
$$;

-- Whether a person holds a role anywhere on a given date.
create or replace function private.holds_role(p_person uuid, p_role text, p_on date)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.positions ps
     where ps.person_id = p_person
       and ps.role = p_role
       and ps.starts_on <= p_on
       and (ps.ends_on is null or ps.ends_on >= p_on)
  )
$$;

-- Holder of dept_head in exactly this department on a date (no inheritance).
create or replace function private.dept_head_of(p_dept uuid, p_on date)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select ps.person_id
    from public.positions ps
   where ps.department_id = p_dept
     and ps.role = 'dept_head'
     and ps.starts_on <= p_on
     and (ps.ends_on is null or ps.ends_on >= p_on)
   limit 1
$$;

-- Elder for a department on a date: the department's own elder, otherwise the
-- nearest ancestor's elder (committee-level assignment is inherited).
create or replace function private.elder_of(p_dept uuid, p_on date)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  with recursive chain as (
    select d.id, d.parent_id, 0 as depth from public.departments d where d.id = p_dept
    union all
    select d.id, d.parent_id, c.depth + 1
      from public.departments d
      join chain c on d.id = c.parent_id
     where c.depth < 20
  )
  select ps.person_id
    from chain c
    join public.positions ps on ps.department_id = c.id
   where ps.role = 'elder'
     and ps.starts_on <= p_on
     and (ps.ends_on is null or ps.ends_on >= p_on)
   order by c.depth
   limit 1
$$;

-- Who may verify and pay a claim: an active finance member who is not the
-- author; if no such finance member exists, an active finance elder (A9).
create or replace function private.can_handle_finance(p_claim uuid, p_person uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_today date := private.today();
  v_other_finance boolean;
begin
  if p_person is null then
    return false;
  end if;
  select author_id into v_author from public.claims where id = p_claim;
  if not found or v_author = p_person then
    return false;
  end if;
  if private.holds_role(p_person, 'finance', v_today) then
    return true;
  end if;
  select exists (
    select 1
      from public.positions ps
      join public.people p on p.id = ps.person_id and p.status = 'active'
     where ps.role = 'finance'
       and ps.person_id <> v_author
       and ps.starts_on <= v_today
       and (ps.ends_on is null or ps.ends_on >= v_today)
  ) into v_other_finance;
  return not v_other_finance and private.holds_role(p_person, 'finance_elder', v_today);
end
$$;

-- Read access to a claim (single source for table policies, storage and routes).
create or replace function private.can_read_claim(p_claim uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  v_today date;
begin
  if v_me is null then
    return false;
  end if;
  if exists (select 1 from public.claims c where c.id = p_claim and c.author_id = v_me) then
    return true;
  end if;
  if exists (select 1 from public.approval_steps s where s.claim_id = p_claim and s.approver_id = v_me) then
    return true;
  end if;
  if private.is_auditor() then
    return true;
  end if;
  v_today := private.today();
  if private.holds_role(v_me, 'finance', v_today) or private.holds_role(v_me, 'finance_elder', v_today) then
    return exists (
      select 1 from public.claims c
       where c.id = p_claim and c.status in ('approved', 'received', 'paid', 'cancelled')
    );
  end if;
  return false;
end
$$;

-- Edit access: the author, while the claim is a draft.
create or replace function private.can_edit_claim(p_claim uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.claims c
     where c.id = p_claim
       and c.status = 'draft'
       and c.author_id = private.current_member_id()
  )
$$;

create or replace function private.try_uuid(p_text text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end
$$;

-- Hash of what an approver sees: lines, total, receipt hashes, check delivery.
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
                      'total_cents', c.total_cents, 'check_delivery', c.check_delivery)
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

-- Queue an email notification inside the caller's transaction.
create or replace function private.notify(p_claim uuid, p_recipient uuid, p_kind text)
returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into public.notifications (claim_id, recipient_id, kind)
  values (p_claim, p_recipient, p_kind)
$$;

-- Only the helpers referenced by RLS policies are executable by clients'
-- roles. The rest are called from SECURITY DEFINER functions (as owner).
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.current_member_id(),
  private.is_member(),
  private.is_admin(),
  private.is_auditor(),
  private.can_read_claim(uuid),
  private.can_edit_claim(uuid),
  private.try_uuid(text),
  private.today(),
  private.church_tz(),
  private.has_grant(uuid, text),
  private.holds_role(uuid, text, date)
to authenticated;

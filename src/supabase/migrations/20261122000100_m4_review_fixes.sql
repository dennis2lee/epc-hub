-- M4 red-team fixes (doc/reviews/2026-11-22-m4-redteam.md).

-- ---------------------------------------------------------------------------
-- anon has no business with any table. Two M1 tables were created before the
-- default-privilege revoke and kept read privileges.
-- ---------------------------------------------------------------------------
revoke all on public.claim_duplicates, public.claim_returns from anon;

-- ---------------------------------------------------------------------------
-- A notice that could not reach the author (changes requested, check issued,
-- check voided) is as stuck as one that could not reach an approver.
-- ---------------------------------------------------------------------------
create or replace function private.notify_failed(p_claim uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.notifications n join public.claims c on c.id = n.claim_id
     where n.claim_id = p_claim
       and n.status in ('no_address', 'failed')
       and n.created_at >= c.updated_at
       and n.kind in ('review_requested', 'finance_requested', 'changes_requested', 'documents_requested',
                      'check_ready', 'check_issued', 'check_voided')
  )
$$;

-- ---------------------------------------------------------------------------
-- Daily digest: a run is claimed, then finished only when a mail went out.
-- A crash or provider outage leaves it unfinished, and the next call after
-- ten minutes may claim it again (same pattern as notifications, D25).
-- ---------------------------------------------------------------------------
alter table public.digest_runs
  add column claimed_at timestamptz,
  add column sent_at timestamptz;
update public.digest_runs set claimed_at = at, sent_at = at;

create or replace function public.claim_digest_run_srv()
returns boolean
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  insert into public.digest_runs (run_date, claimed_at) values (private.today(), now())
  on conflict (run_date) do update
     set claimed_at = now()
   where public.digest_runs.sent_at is null
     and public.digest_runs.claimed_at < now() - interval '10 minutes';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$$;

create or replace function public.finish_digest_run_srv()
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.digest_runs set sent_at = now() where run_date = private.today() and sent_at is null
$$;

-- Give the claim back at once (an RPC failed before anything was sent).
create or replace function public.release_digest_run_srv()
returns void
language sql volatile security definer
set search_path = ''
as $$
  delete from public.digest_runs where run_date = private.today() and sent_at is null
$$;

revoke execute on function public.finish_digest_run_srv(), public.release_digest_run_srv() from public, anon, authenticated;
grant execute on function public.finish_digest_run_srv(), public.release_digest_run_srv() to service_role;

-- ---------------------------------------------------------------------------
-- Stuck thresholds fit a weekly (Sunday) rhythm: an approver step is late
-- after 8 days, finance work after 10. Problems that need a person (no
-- approver, failed mail, no finance handler) still show at once. The lists
-- also name the author and whom the claim waits on, so the office can call.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('stuck_days_approval', '8'),
  ('stuck_days_finance', '10')
on conflict (key) do nothing;
delete from public.app_settings where key = 'stuck_days';

create or replace function private.is_stuck(c public.claims, p_approver uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when c.status = 'draft' then c.blocked_reason is not null
    -- The author could not be told (changes requested, check issued or voided).
    when c.status in ('rejected', 'paid') then private.notify_failed(c.id)
    when c.status not in ('in_review', 'approved', 'received') then false
    else c.blocked_reason is not null
      or (c.status = 'in_review' and not private.is_cleared(p_approver))
      or private.notify_failed(c.id)
      or (private.today() - private.local_date(c.updated_at, private.church_tz()))
           >= case when c.status = 'in_review' then private.setting_int('stuck_days_approval', 8)
                   else private.setting_int('stuck_days_finance', 10) end
  end
$$;

create or replace function private.stuck_problem(c public.claims, p_approver uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(c.blocked_reason,
                  case when c.status = 'in_review' and not private.is_cleared(p_approver) then 'approver_not_active'
                       when private.notify_failed(c.id) then 'notify_failed'
                       else 'waiting' end)
$$;

drop function public.stuck_claims();
create function public.stuck_claims()
returns table (claim_id uuid, claim_no text, department text, status public.claim_status,
               author text, waiting_on text, problem text, days_waiting int, version int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select c.id, c.claim_no, d.name, c.status, a.name,
           case when c.status = 'in_review' then p.name
                when c.status in ('approved', 'received') then '재정부'
                else a.name end,
           private.stuck_problem(c, s.approver_id),
           (private.today() - private.local_date(coalesce(c.blocked_at, c.updated_at), private.church_tz()))::int,
           c.version
      from public.claims c
      join public.departments d on d.id = c.department_id
      join public.people a on a.id = c.author_id
      left join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
      left join public.people p on p.id = s.approver_id
     where private.is_stuck(c, s.approver_id)
     order by coalesce(c.blocked_at, c.updated_at);
end
$$;

drop function public.stuck_digest_srv();
create function public.stuck_digest_srv()
returns table (claim_no text, department text, author text, waiting_on text, problem text, days_waiting int)
language sql stable security definer
set search_path = ''
as $$
  select c.claim_no, d.name, a.name,
         case when c.status = 'in_review' then p.name
              when c.status in ('approved', 'received') then '재정부'
              else a.name end,
         private.stuck_problem(c, s.approver_id),
         (private.today() - private.local_date(coalesce(c.blocked_at, c.updated_at), private.church_tz()))::int
    from public.claims c
    join public.departments d on d.id = c.department_id
    join public.people a on a.id = c.author_id
    left join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
    left join public.people p on p.id = s.approver_id
   where private.is_stuck(c, s.approver_id)
   order by 6 desc
$$;

revoke execute on function public.stuck_digest_srv() from public, anon, authenticated;
grant execute on function public.stuck_digest_srv() to service_role;
revoke execute on function public.stuck_claims() from public, anon;
grant execute on function public.stuck_claims() to authenticated;

-- Claims sent back to the author and untouched for 30 days: shown to the
-- office (no mail), so it can ask the author to revise or cancel.
create or replace function public.admin_author_waiting()
returns table (claim_id uuid, claim_no text, department text, author text, author_status public.person_status,
               status public.claim_status, days_waiting int, version int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select c.id, c.claim_no, d.name, a.name, a.status, c.status,
           (private.today() - private.local_date(c.updated_at, private.church_tz()))::int, c.version
      from public.claims c
      join public.departments d on d.id = c.department_id
      join public.people a on a.id = c.author_id
     where (c.status = 'rejected' or (c.status = 'draft' and c.claim_no is not null))
       and ((private.today() - private.local_date(c.updated_at, private.church_tz())) >= 30
            or a.status <> 'active')
     order by c.updated_at;
end
$$;
revoke execute on function public.admin_author_waiting() from public, anon;
grant execute on function public.admin_author_waiting() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin cancel for a claim whose author can no longer act (suspended or
-- left). Only numbered drafts and claims sent back; in-flight claims are
-- first sent back by the approver or finance (D22). Claim numbers are never
-- reused.
-- ---------------------------------------------------------------------------
create or replace function public.admin_cancel_claim(p_claim uuid, p_version int, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  c public.claims%rowtype;
begin
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'reason_required'; end if;
  select * into c from public.claims where id = p_claim for update;
  if not found then raise exception 'not_found'; end if;
  if c.author_id = v_me then raise exception 'cannot_change_self'; end if;
  if c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  if not (c.status = 'rejected' or (c.status = 'draft' and c.claim_no is not null)) then
    raise exception 'not_cancellable';
  end if;
  if exists (select 1 from public.people where id = c.author_id and status = 'active') then
    raise exception 'author_active';
  end if;
  update public.claims
     set status = 'cancelled', return_reason = left(trim(p_reason), 300), version = version + 1, updated_at = now()
   where id = p_claim;
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, after)
  values (v_me, (select auth.uid()), 'admin_cancel', 'claims', p_claim::text,
          jsonb_build_object('reason', left(trim(p_reason), 300), 'from_status', c.status));
end
$$;
revoke execute on function public.admin_cancel_claim(uuid, int, text) from public, anon;
grant execute on function public.admin_cancel_claim(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-linking a login. A person who signed in another way (Kakao instead of
-- the email code, or another address) has no way back today. The office
-- removes the old logins; the person returns to "invited" and is linked
-- again by a fresh invite. Approver-class people need a new in-person check
-- (D12). The old address is told, as for an email change (D25).
-- ---------------------------------------------------------------------------
create or replace function public.admin_relink_person(p_person uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  p public.people%rowtype;
begin
  if p_person = v_me then raise exception 'cannot_change_self'; end if;
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'reason_required'; end if;
  select * into p from public.people where id = p_person for update;
  if not found then raise exception 'not_found'; end if;
  if p.status = 'suspended' then raise exception 'is_suspended'; end if;
  if not exists (select 1 from public.person_logins where person_id = p_person) then raise exception 'not_linked'; end if;

  delete from public.person_logins where person_id = p_person;
  update public.invites set expires_at = now() where person_id = p_person and used_at is null and expires_at > now();
  update public.people
     set status = 'invited',
         in_person_checked_at = case when needs_in_person_check then null else in_person_checked_at end
   where id = p_person;
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, after)
  values (v_me, (select auth.uid()), 'relink', 'people', p_person::text,
          jsonb_build_object('reason', left(trim(p_reason), 300)));
  if p.email is not null then
    insert into public.notifications (recipient_id, kind, to_address) values (p_person, 'login_reset', p.email);
  end if;
end
$$;
revoke execute on function public.admin_relink_person(uuid, text) from public, anon;
grant execute on function public.admin_relink_person(uuid, text) to authenticated;

-- An invite may be sent to anyone not yet linked (a re-linked person is
-- "invited" again; "pending" people without a login also qualify).
create or replace function public.admin_create_invite(p_person uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not exists (select 1 from public.people where id = p_person and status in ('invited', 'pending'))
     or exists (select 1 from public.person_logins where person_id = p_person) then
    raise exception 'not_invitable';
  end if;
  update public.invites set expires_at = now() where person_id = p_person and used_at is null and expires_at > now();
  insert into public.invites (person_id, token_hash, expires_at, created_by)
  values (p_person, private.hash_token(v_token), now() + interval '7 days', v_me);
  return v_token;
end
$$;

-- ---------------------------------------------------------------------------
-- Admin edit of a registered person. Before linking it is a plain fix of a
-- typo; after linking a reason is required and the old address is told.
-- A phone change voids open invites (the last-4 check would differ).
-- Payee names on submitted claims never change (D16).
-- ---------------------------------------------------------------------------
create or replace function public.admin_person_detail(p_person uuid)
returns table (id uuid, name text, legal_name_en text, phone_e164 text, email text, church_title text,
               status public.person_status, login_methods text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select p.id, p.name, p.legal_name_en, p.phone_e164, p.email, p.church_title, p.status,
           (select string_agg(distinct l.provider, ', ') from public.person_logins l where l.person_id = p.id)
      from public.people p where p.id = p_person;
end
$$;
revoke execute on function public.admin_person_detail(uuid) from public, anon;
grant execute on function public.admin_person_detail(uuid) to authenticated;

create or replace function public.admin_update_person(
  p_person uuid, p_name text, p_legal_name_en text, p_phone_e164 text, p_email text, p_church_title text, p_reason text
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  p public.people%rowtype;
  v_email text := nullif(trim(p_email), '');
  v_linked boolean;
begin
  if p_person = v_me then raise exception 'cannot_change_self'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254) then
    raise exception 'bad_email';
  end if;
  select * into p from public.people where id = p_person for update;
  if not found then raise exception 'not_found'; end if;
  v_linked := exists (select 1 from public.person_logins where person_id = p_person);
  if v_linked and length(coalesce(trim(p_reason), '')) < 5 then raise exception 'reason_required'; end if;

  update public.people
     set name = trim(p_name),
         legal_name_en = nullif(trim(p_legal_name_en), ''),
         phone_e164 = nullif(trim(p_phone_e164), ''),
         email = v_email,
         church_title = nullif(trim(p_church_title), '')
   where id = p_person;
  if p.phone_e164 is distinct from nullif(trim(p_phone_e164), '') then
    update public.invites set expires_at = now() where person_id = p_person and used_at is null and expires_at > now();
  end if;
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, after)
  values (v_me, (select auth.uid()), 'admin_edit', 'people', p_person::text,
          jsonb_build_object('reason', nullif(left(trim(coalesce(p_reason, '')), 300), '')));
  if v_linked and p.email is not null and p.email is distinct from v_email then
    insert into public.notifications (recipient_id, kind, to_address) values (p_person, 'email_changed', p.email);
  end if;
end
$$;
revoke execute on function public.admin_update_person(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_person(uuid, text, text, text, text, text, text) to authenticated;

-- admin_people also tells how each person signs in, so the office can say
-- "please use Kakao" instead of sending a new invite.
drop function public.admin_people();
create function public.admin_people()
returns table (id uuid, name text, phone_last4 text, has_email boolean, status public.person_status,
               needs_in_person_check boolean, in_person_checked_at timestamptz, logins int, login_methods text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select p.id, p.name, right(p.phone_e164, 4), p.email is not null, p.status, p.needs_in_person_check,
           p.in_person_checked_at,
           (select count(*)::int from public.person_logins l where l.person_id = p.id),
           (select string_agg(distinct l.provider, ', ') from public.person_logins l where l.person_id = p.id)
      from public.people p
     order by p.name;
end
$$;
revoke execute on function public.admin_people() from public, anon;
grant execute on function public.admin_people() to authenticated;

-- ---------------------------------------------------------------------------
-- Linking by email code fills in a missing notification address, so people
-- registered without an email still get notices.
-- ---------------------------------------------------------------------------
create or replace function private.fill_email_on_link()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = new.auth_user_id;
  if v_email is not null and v_email <> '' then
    update public.people set email = v_email where id = new.person_id and email is null;
  end if;
  return new;
end
$$;

create trigger person_logins_fill_email after insert on public.person_logins
  for each row execute function private.fill_email_on_link();

-- ---------------------------------------------------------------------------
-- Grants. The first admin is created once by the operator with the service
-- role (doc/deploy.md); after that admins grant and revoke through the app.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_first_admin(
  p_auth_user uuid, p_name text, p_phone_e164 text, p_email text, p_basis text
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_provider text;
begin
  if exists (select 1 from public.admin_grants g join public.people p on p.id = g.person_id
              where g.grant_kind = 'admin' and g.revoked_at is null and p.status = 'active') then
    raise exception 'admin_exists';
  end if;
  if coalesce(trim(p_basis), '') = '' then raise exception 'reason_required'; end if;
  select coalesce(u.raw_app_meta_data ->> 'provider', 'unknown') into v_provider from auth.users u where u.id = p_auth_user;
  if not found then raise exception 'not_found'; end if;
  perform set_config('app.actor_auth', p_auth_user::text, true);

  insert into public.people (name, phone_e164, email, status, needs_in_person_check)
  values (trim(p_name), nullif(trim(p_phone_e164), ''), nullif(trim(p_email), ''), 'active', true)
  returning id into v_id;
  insert into public.person_logins (auth_user_id, person_id, provider, linked_via)
  values (p_auth_user, v_id, v_provider, 'admin');
  insert into public.admin_grants (person_id, grant_kind, basis) values (v_id, 'admin', '초기 설정: ' || trim(p_basis));
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, after)
  values (v_id, p_auth_user, 'bootstrap', 'people', v_id::text, jsonb_build_object('basis', trim(p_basis)));
  return v_id;
end
$$;
revoke execute on function public.bootstrap_first_admin(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid, text, text, text, text) to service_role;

create or replace function public.admin_list_grants()
returns table (id uuid, person_id uuid, name text, grant_kind text, basis text, granted_at timestamptz)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or private.is_auditor()) then raise exception 'not_admin'; end if;
  return query
    select g.id, g.person_id, p.name, g.grant_kind, g.basis, g.granted_at
      from public.admin_grants g join public.people p on p.id = g.person_id
     where g.revoked_at is null and g.grant_kind in ('admin', 'auditor')
     order by g.grant_kind, p.name;
end
$$;
revoke execute on function public.admin_list_grants() from public, anon;
grant execute on function public.admin_list_grants() to authenticated;

create or replace function public.admin_grant(p_person uuid, p_kind text, p_basis text)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  p public.people%rowtype;
  v_id uuid;
begin
  if p_person = v_me then raise exception 'cannot_change_self'; end if;
  if p_kind not in ('admin', 'auditor') then raise exception 'bad_request'; end if;
  if length(coalesce(trim(p_basis), '')) < 5 then raise exception 'reason_required'; end if;
  select * into p from public.people where id = p_person for update;
  if not found then raise exception 'not_found'; end if;
  -- Grantee must be signed in and confirmed in person by someone else.
  if p.status <> 'active' or p.in_person_checked_at is null then raise exception 'grantee_not_cleared'; end if;
  if exists (select 1 from public.admin_grants g where g.person_id = p_person and g.grant_kind = p_kind and g.revoked_at is null) then
    raise exception 'already_granted';
  end if;
  -- An auditor must be independent of the office and of finance.
  if p_kind = 'auditor' and (private.has_grant(p_person, 'admin') or private.holds_role(p_person, 'finance', private.today())
                             or private.holds_role(p_person, 'finance_elder', private.today())) then
    raise exception 'auditor_not_independent';
  end if;
  if p_kind = 'admin' and private.has_grant(p_person, 'auditor') then raise exception 'auditor_not_independent'; end if;
  insert into public.admin_grants (person_id, grant_kind, basis) values (p_person, p_kind, trim(p_basis))
  returning id into v_id;
  update public.people set needs_in_person_check = true where id = p_person;
  return v_id;
end
$$;
revoke execute on function public.admin_grant(uuid, text, text) from public, anon;
grant execute on function public.admin_grant(uuid, text, text) to authenticated;

create or replace function public.admin_revoke(p_grant uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  g public.admin_grants%rowtype;
begin
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'reason_required'; end if;
  select * into g from public.admin_grants where id = p_grant and revoked_at is null for update;
  if not found then raise exception 'not_found'; end if;
  if g.person_id = v_me then raise exception 'cannot_change_self'; end if;
  if g.grant_kind = 'admin' and private.active_admin_count() <= 1 then raise exception 'last_admin'; end if;
  update public.admin_grants set revoked_at = now() where id = p_grant;
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, after)
  values (v_me, (select auth.uid()), 'revoke', 'admin_grants', p_grant::text,
          jsonb_build_object('reason', left(trim(p_reason), 300)));
end
$$;
revoke execute on function public.admin_revoke(uuid, text) from public, anon;
grant execute on function public.admin_revoke(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Invite validity for the login screen (service role only): an email code may
-- create a new login only while the browser holds a live invite.
-- ---------------------------------------------------------------------------
create or replace function public.invite_open_srv(p_token text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.invites i
     where i.token_hash = private.hash_token(p_token)
       and i.used_at is null and i.locked_at is null and i.expires_at > now()
  )
$$;
revoke execute on function public.invite_open_srv(text) from public, anon, authenticated;
grant execute on function public.invite_open_srv(text) to service_role;

-- ---------------------------------------------------------------------------
-- Duplicate hints beyond identical files (per-receipt fields were dropped in
-- M2): the same author with the same total and date, and the same department
-- with the same total and date. Warnings only. The department-wide hint is
-- not shown to the author (it points at someone else's claim).
-- ---------------------------------------------------------------------------
alter table public.claim_duplicates drop constraint claim_duplicates_reason_check;
alter table public.claim_duplicates add constraint claim_duplicates_reason_check
  check (reason in ('same_file', 'same_receipt', 'same_amount_date', 'dept_amount_date'));

drop policy "read duplicates of readable claims" on public.claim_duplicates;
create policy "read duplicates of readable claims" on public.claim_duplicates
  for select to authenticated
  using ((select private.can_read_claim(claim_id))
         and (reason <> 'dept_amount_date'
              or not exists (select 1 from public.claims c where c.id = claim_id
                              and c.author_id = (select private.current_member_id()))));

create or replace function private.flag_amount_date_duplicates()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'in_review' and old.status = 'draft' then
    insert into public.claim_duplicates (claim_id, other_claim_id, reason)
    select new.id, oc.id,
           case when oc.author_id = new.author_id then 'same_amount_date' else 'dept_amount_date' end
      from public.claims oc
     where oc.id <> new.id
       and oc.total_cents = new.total_cents
       and oc.expense_date = new.expense_date
       and oc.status in ('in_review', 'rejected', 'approved', 'received', 'paid')
       and (oc.author_id = new.author_id or oc.department_id = new.department_id)
    on conflict do nothing;
    if exists (select 1 from public.claim_duplicates where claim_id = new.id) then
      new.dup_warning := true;
    end if;
  end if;
  return new;
end
$$;

create trigger claims_flag_amount_date_duplicates before update on public.claims
  for each row execute function private.flag_amount_date_duplicates();

-- New private helpers are for definer functions and triggers only.
revoke execute on function private.is_stuck(public.claims, uuid), private.stuck_problem(public.claims, uuid),
  private.fill_email_on_link(), private.flag_amount_date_duplicates()
  from public, anon, authenticated;

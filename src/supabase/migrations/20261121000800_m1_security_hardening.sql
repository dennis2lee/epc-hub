-- M1 security red-team fixes (doc/reviews/2026-11-21-m1-redteam.md).

-- ---------------------------------------------------------------------------
-- Default privileges: new objects must not be born with client access.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public;

revoke select on public.invites, public.person_logins, public.notifications, public.claim_counters from authenticated;
revoke execute on function private.has_grant(uuid, text), private.holds_role(uuid, text, date),
  private.today(), private.church_tz() from authenticated;

-- ---------------------------------------------------------------------------
-- Audit log: append-only for every role, with the database role recorded.
-- ---------------------------------------------------------------------------
alter table public.audit_logs
  add column db_role text not null default session_user,
  add column jwt_role text default (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');

create or replace function private.audit_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only';
end
$$;

create trigger audit_no_change before update or delete on public.audit_logs
  for each row execute function private.audit_immutable();
create trigger audit_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_immutable();
revoke update, delete, truncate on public.audit_logs from service_role;

-- Server-side calls (service role) pass the acting login explicitly.
create or replace function private.actor_auth()
returns uuid
language sql stable
set search_path = ''
as $$
  select coalesce((select auth.uid()), private.try_uuid(nullif(current_setting('app.actor_auth', true), '')))
$$;

create or replace function private.audit_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_auth uuid := private.actor_auth();
begin
  insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, before, after)
  values (
    (select l.person_id from public.person_logins l where l.auth_user_id = v_auth),
    v_auth,
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'claim_id', v_old ->> 'claim_id',
             v_new ->> 'auth_user_id', v_old ->> 'auth_user_id', v_new ->> 'key', v_old ->> 'key'),
    v_old,
    v_new
  );
  return coalesce(new, old);
end
$$;

-- Receipt files are evidence: log every object change in the receipts bucket.
create or replace function private.audit_receipt_object()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(new.name, old.name);
  v_bucket text := coalesce(new.bucket_id, old.bucket_id);
  v_auth uuid := private.actor_auth();
begin
  if v_bucket = 'receipts' then
    insert into public.audit_logs (actor_id, actor_auth, action, entity, entity_id, before, after)
    values ((select l.person_id from public.person_logins l where l.auth_user_id = v_auth), v_auth,
            lower(tg_op), 'storage.receipts', v_name,
            case when tg_op <> 'INSERT' then jsonb_build_object('name', old.name, 'metadata', old.metadata) end,
            case when tg_op <> 'DELETE' then jsonb_build_object('name', new.name, 'metadata', new.metadata) end);
  end if;
  return coalesce(new, old);
end
$$;

create trigger audit_receipt_objects after insert or update or delete on storage.objects
  for each row execute function private.audit_receipt_object();

-- ---------------------------------------------------------------------------
-- Read scope narrowed to the design (§12): approvers see a claim while it is
-- their turn or after they decided; auditors do not read drafts.
-- ---------------------------------------------------------------------------
create or replace function private.can_read_claim(p_claim uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
  c public.claims%rowtype;
  v_today date;
begin
  if v_me is null then return false; end if;
  select * into c from public.claims where id = p_claim;
  if not found then return false; end if;
  if c.author_id = v_me then return true; end if;
  if c.status in ('draft', 'deleted') then return false; end if;
  if exists (
    select 1 from public.approval_steps s
     where s.claim_id = p_claim and s.approver_id = v_me
       and (s.decision is not null
            or (s.round = c.round and c.status = 'in_review' and s.seq <= c.current_seq))
  ) then
    return true;
  end if;
  if private.is_auditor() then return true; end if;
  v_today := private.today();
  if c.status in ('approved', 'received', 'paid', 'cancelled')
     and (private.holds_role(v_me, 'finance', v_today) or private.holds_role(v_me, 'finance_elder', v_today)) then
    return true;
  end if;
  return false;
end
$$;

-- ---------------------------------------------------------------------------
-- Attachments: only the server (service role) records them, after computing
-- SHA-256 from the bytes; size and type come from storage metadata.
-- ---------------------------------------------------------------------------
revoke execute on function public.add_attachment(uuid, text, text, bigint, text, text, date, bigint) from authenticated;

create or replace function public.add_attachment_srv(
  p_actor_auth uuid,
  p_claim uuid,
  p_storage_path text,
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
  c public.claims%rowtype;
  v_person uuid;
  v_mime text;
  v_bytes bigint;
  v_owner text;
  v_id uuid;
begin
  perform set_config('app.actor_auth', p_actor_auth::text, true);
  select p.id into v_person
    from public.person_logins l join public.people p on p.id = l.person_id
   where l.auth_user_id = p_actor_auth and p.status in ('active', 'pending');
  if v_person is null then raise exception 'not_member'; end if;

  select * into c from public.claims where id = p_claim for update;
  if not found or c.status <> 'draft' or c.author_id <> v_person then raise exception 'stale_or_closed'; end if;
  if split_part(p_storage_path, '/', 1) <> p_claim::text then raise exception 'bad_path'; end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'bad_hash'; end if;

  select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint, coalesce(o.owner_id, o.owner::text)
    into v_mime, v_bytes, v_owner
    from storage.objects o where o.bucket_id = 'receipts' and o.name = p_storage_path;
  if not found then raise exception 'missing_object'; end if;
  if v_owner is distinct from p_actor_auth::text then raise exception 'bad_path'; end if;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') then
    raise exception 'bad_type';
  end if;
  if exists (select 1 from public.attachments a where a.claim_id = p_claim and a.sha256 = p_sha256) then
    raise exception 'duplicate_receipt';
  end if;

  insert into public.attachments (claim_id, storage_path, mime, bytes, sha256, merchant, receipt_date, amount_cents)
  values (p_claim, p_storage_path, v_mime, coalesce(v_bytes, 0), p_sha256, left(nullif(trim(p_merchant), ''), 100),
          p_receipt_date, p_amount_cents)
  returning id into v_id;
  update public.claims set version = version + 1, updated_at = now() where id = p_claim;
  return v_id;
end
$$;

-- Removing an attachment row; the file is deleted only if the claim was never
-- submitted (otherwise the file stays as evidence of what approvers saw).
drop function public.remove_attachment(uuid);
create function public.remove_attachment(p_attachment uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  a public.attachments%rowtype;
  c public.claims%rowtype;
begin
  select * into a from public.attachments where id = p_attachment;
  if not found then raise exception 'not_found'; end if;
  select * into c from public.claims where id = a.claim_id for update;
  if c.status <> 'draft' or c.author_id is distinct from private.current_drafter_id() then
    raise exception 'stale_or_closed';
  end if;
  delete from public.attachments where id = p_attachment;
  update public.claims set version = version + 1, updated_at = now() where id = a.claim_id;
  return jsonb_build_object('path', a.storage_path, 'delete_file', c.first_submitted_at is null);
end
$$;

-- No client may delete receipt files; the server deletes never-submitted files.
drop policy "receipts delete while draft" on storage.objects;

-- Submit also requires every recorded receipt file to exist.
create or replace function private.receipts_present(p_claim uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.attachments a where a.claim_id = p_claim)
     and not exists (
       select 1 from public.attachments a
        where a.claim_id = p_claim
          and not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = a.storage_path)
     )
$$;

-- ---------------------------------------------------------------------------
-- Invites: lock after 5 wrong attempts; a new invite voids older ones.
-- ---------------------------------------------------------------------------
alter table public.invites
  add column failed_attempts int not null default 0,
  add column locked_at timestamptz;

create or replace function public.accept_invite(p_token text, p_last4 text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  i public.invites%rowtype;
  p public.people%rowtype;
  v_provider text;
  v_status public.person_status;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.person_logins where auth_user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;
  select * into i from public.invites where token_hash = private.hash_token(p_token) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invite_not_found'); end if;
  if i.used_at is not null then return jsonb_build_object('ok', false, 'reason', 'invite_used'); end if;
  if i.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'invite_expired'); end if;
  if i.locked_at is not null then return jsonb_build_object('ok', false, 'reason', 'invite_locked'); end if;

  select * into p from public.people where id = i.person_id for update;
  if p.phone_e164 is null or right(p.phone_e164, 4) <> coalesce(p_last4, '') then
    -- Committed (no exception) so the attempt counter persists.
    update public.invites
       set failed_attempts = failed_attempts + 1,
           locked_at = case when failed_attempts + 1 >= 5 then now() end
     where id = i.id;
    return jsonb_build_object('ok', false, 'reason', case when i.failed_attempts + 1 >= 5 then 'invite_locked' else 'last4_mismatch' end);
  end if;
  if exists (select 1 from public.person_logins where person_id = p.id) or p.status not in ('invited', 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'person_already_linked');
  end if;

  select coalesce(u.raw_app_meta_data ->> 'provider', 'unknown') into v_provider from auth.users u where u.id = v_uid;
  insert into public.person_logins (auth_user_id, person_id, provider, linked_via) values (v_uid, p.id, v_provider, 'invite');
  update public.invites set used_at = now() where id = i.id;

  v_status := case when p.needs_in_person_check and p.in_person_checked_at is null
                   then 'pending'::public.person_status else 'active'::public.person_status end;
  update public.people set status = v_status where id = p.id;
  return jsonb_build_object('ok', true, 'status', v_status, 'name', p.name);
end
$$;

create or replace function public.admin_create_invite(p_person uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not exists (select 1 from public.people where id = p_person and status in ('invited', 'pending')) then
    raise exception 'not_invitable';
  end if;
  update public.invites set expires_at = now() where person_id = p_person and used_at is null and expires_at > now();
  insert into public.invites (person_id, token_hash, expires_at, created_by)
  values (p_person, private.hash_token(v_token), now() + interval '7 days', v_me);
  return v_token;
end
$$;

-- ---------------------------------------------------------------------------
-- Single-admin period: admins cannot clear or assign themselves, and claims
-- submitted while fewer than two admins exist are flagged for the auditor.
-- ---------------------------------------------------------------------------
alter table public.claims add column solo_admin_period boolean not null default false;

create or replace function private.active_admin_count()
returns int
language sql stable security definer
set search_path = ''
as $$
  select count(distinct g.person_id)::int
    from public.admin_grants g join public.people p on p.id = g.person_id and p.status = 'active'
   where g.grant_kind = 'admin' and g.revoked_at is null
$$;

create or replace function private.flag_solo_admin()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'in_review' and old.status = 'draft' then
    new.solo_admin_period := private.active_admin_count() < 2;
  end if;
  return new;
end
$$;

create trigger claims_flag_solo_admin before update on public.claims
  for each row execute function private.flag_solo_admin();

create or replace function public.admin_confirm_in_person(p_person uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
begin
  if p_person = v_me then raise exception 'cannot_confirm_self'; end if;
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
  v_me uuid := private.require_admin();
  v_id uuid;
begin
  if p_person = v_me and private.active_admin_count() >= 2 then raise exception 'cannot_assign_self'; end if;
  if p_role in ('finance', 'finance_elder')
     and not exists (select 1 from public.departments d where d.id = p_department and d.is_finance) then
    raise exception 'finance_role_needs_finance_department';
  end if;
  insert into public.positions (person_id, department_id, role, starts_on, ends_on)
  values (p_person, p_department, p_role, p_starts_on, p_ends_on)
  returning id into v_id;
  -- The role only counts after an in-person check (private.is_cleared).
  update public.people
     set needs_in_person_check = true,
         in_person_checked_at = case when needs_in_person_check then in_person_checked_at end
   where id = p_person;
  return v_id;
end
$$;

create or replace function public.admin_set_person_status(p_person uuid, p_status public.person_status)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
begin
  if p_person = v_me then raise exception 'cannot_change_self'; end if;
  if p_status = 'active' then raise exception 'use_confirm_in_person'; end if;
  update public.people set status = p_status where id = p_person;
  if not found then raise exception 'not_found'; end if;
end
$$;

create or replace function public.admin_end_position(p_position uuid, p_ends_on date)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  ps public.positions%rowtype;
begin
  perform private.require_admin();
  select * into ps from public.positions where id = p_position for update;
  if not found then raise exception 'not_found'; end if;
  if p_ends_on is null or p_ends_on < ps.starts_on or p_ends_on < private.today() - 31 then
    raise exception 'bad_end_date';
  end if;
  update public.positions set ends_on = p_ends_on where id = p_position;
end
$$;

-- ---------------------------------------------------------------------------
-- NULL-safe version checks for functions not replaced in the previous migration.
-- ---------------------------------------------------------------------------
create or replace function public.start_revision(p_claim uuid, p_version int)
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
  if c.status <> 'rejected' or c.version is distinct from p_version then raise exception 'stale_or_closed'; end if;
  update public.claims set status = 'draft', current_seq = 0, version = version + 1, updated_at = now()
   where id = p_claim;
end
$$;

create or replace function public.update_my_profile(p_email text, p_mail_address text, p_legal_name_en text, p_lang text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_drafter_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  if coalesce(p_lang, '') not in ('ko', 'en') then raise exception 'bad_lang'; end if;
  if p_email is not null and trim(p_email) <> '' and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_email';
  end if;
  if length(coalesce(p_mail_address, '')) > 300 or length(coalesce(p_legal_name_en, '')) > 100 then
    raise exception 'too_long';
  end if;
  -- Payee names are fixed per claim at submission, so later edits do not
  -- affect claims already in review.
  update public.people
     set email = nullif(trim(p_email), ''),
         mail_address = nullif(trim(p_mail_address), ''),
         legal_name_en = nullif(trim(p_legal_name_en), ''),
         lang = p_lang
   where id = v_me;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges for the functions above.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
revoke execute on function public.add_attachment_srv(uuid, uuid, text, text, text, date, bigint) from authenticated;
grant execute on function public.add_attachment_srv(uuid, uuid, text, text, text, date, bigint) to service_role;
grant execute on function private.actor_auth(), private.try_uuid(text) to service_role;
grant execute on function public.remove_attachment(uuid), public.start_revision(uuid, int),
  public.update_my_profile(text, text, text, text), public.accept_invite(text, text),
  public.admin_create_invite(uuid), public.admin_confirm_in_person(uuid),
  public.admin_assign_position(uuid, uuid, text, date, date),
  public.admin_set_person_status(uuid, public.person_status), public.admin_end_position(uuid, date)
to authenticated;

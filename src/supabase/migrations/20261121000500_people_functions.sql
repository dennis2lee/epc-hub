-- People, invites and organization management (MVP: single admin allowed; the
-- two-person control from design §6 is added before full rollout).

-- ---------------------------------------------------------------------------
-- Self
-- ---------------------------------------------------------------------------
-- Status of the current login, usable before activation (pending screen).
create or replace function public.me()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_any();
  p public.people%rowtype;
  v_today date := private.today();
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('signed_in', false);
  end if;
  if v_person is null then
    return jsonb_build_object('signed_in', true, 'linked', false);
  end if;
  select * into p from public.people where id = v_person;
  return jsonb_build_object(
    'signed_in', true,
    'linked', true,
    'person_id', p.id,
    'name', p.name,
    'status', p.status,
    'lang', p.lang,
    'email', p.email,
    'mail_address', p.mail_address,
    'legal_name_en', p.legal_name_en,
    'is_admin', private.has_grant(p.id, 'admin'),
    'is_auditor', private.has_grant(p.id, 'auditor'),
    'is_finance', private.holds_role(p.id, 'finance', v_today) or private.holds_role(p.id, 'finance_elder', v_today),
    'departments', coalesce((
      select jsonb_agg(distinct jsonb_build_object('id', d.id, 'name', d.name))
        from public.positions ps join public.departments d on d.id = ps.department_id
       where ps.person_id = p.id and ps.starts_on <= v_today and (ps.ends_on is null or ps.ends_on >= v_today)
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.update_my_profile(
  p_email text,
  p_mail_address text,
  p_legal_name_en text,
  p_lang text
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
begin
  if v_me is null then raise exception 'not_member'; end if;
  if p_lang not in ('ko', 'en') then raise exception 'bad_lang'; end if;
  if p_email is not null and trim(p_email) <> '' and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_email';
  end if;
  update public.people
     set email = nullif(trim(p_email), ''),
         mail_address = nullif(trim(p_mail_address), ''),
         legal_name_en = nullif(trim(p_legal_name_en), ''),
         lang = p_lang
   where id = v_me;
end
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create or replace function private.hash_token(p_token text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
$$;

-- Shown after login on /invite/<token>; reveals only the invitee's name.
create or replace function public.invite_preview(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  i public.invites%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  select * into i from public.invites where token_hash = private.hash_token(p_token);
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if i.used_at is not null then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  if i.expires_at < now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  return jsonb_build_object('valid', true, 'name', (select name from public.people where id = i.person_id));
end
$$;

-- Link the current login to the invited person after checking the last four
-- digits of their registered phone. Approvers, finance and admins stay
-- "pending" until confirmed in person (decision D12).
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
    raise exception 'already_linked';
  end if;
  select * into i from public.invites where token_hash = private.hash_token(p_token) for update;
  if not found then raise exception 'invite_not_found'; end if;
  if i.used_at is not null then raise exception 'invite_used'; end if;
  if i.expires_at < now() then raise exception 'invite_expired'; end if;

  select * into p from public.people where id = i.person_id for update;
  if p.phone_e164 is null or right(p.phone_e164, 4) <> coalesce(p_last4, '') then
    raise exception 'last4_mismatch';
  end if;
  if exists (select 1 from public.person_logins where person_id = p.id) then
    -- A second login for an already-linked person needs an in-person check.
    raise exception 'person_already_linked';
  end if;

  select coalesce(u.raw_app_meta_data ->> 'provider', 'unknown') into v_provider
    from auth.users u where u.id = v_uid;

  insert into public.person_logins (auth_user_id, person_id, provider, linked_via)
  values (v_uid, p.id, v_provider, 'invite');
  update public.invites set used_at = now() where id = i.id;

  v_status := case when p.needs_in_person_check then 'pending'::public.person_status
                   else 'active'::public.person_status end;
  if p.status in ('invited', 'pending') then
    update public.people set status = v_status where id = p.id;
  end if;
  return jsonb_build_object('status', v_status, 'name', p.name);
end
$$;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
create or replace function private.require_admin()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_member_id();
begin
  if v_me is null or not private.has_grant(v_me, 'admin') then raise exception 'not_admin'; end if;
  return v_me;
end
$$;

create or replace function public.admin_create_department(p_name text, p_name_en text, p_parent uuid, p_is_finance boolean)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  insert into public.departments (name, name_en, parent_id, is_finance)
  values (trim(p_name), nullif(trim(p_name_en), ''), p_parent, coalesce(p_is_finance, false))
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.admin_create_person(
  p_name text,
  p_legal_name_en text,
  p_phone_e164 text,
  p_email text,
  p_church_title text,
  p_needs_in_person_check boolean
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  insert into public.people (name, legal_name_en, phone_e164, email, church_title, needs_in_person_check)
  values (trim(p_name), nullif(trim(p_legal_name_en), ''), nullif(trim(p_phone_e164), ''),
          nullif(trim(p_email), ''), nullif(trim(p_church_title), ''), coalesce(p_needs_in_person_check, false))
  returning id into v_id;
  return v_id;
end
$$;

-- Returns the raw token once; only its hash is stored.
create or replace function public.admin_create_invite(p_person uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not exists (select 1 from public.people where id = p_person) then raise exception 'not_found'; end if;
  insert into public.invites (person_id, token_hash, expires_at, created_by)
  values (p_person, private.hash_token(v_token), now() + interval '7 days', v_me);
  return v_token;
end
$$;

create or replace function public.admin_set_person_status(p_person uuid, p_status public.person_status)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_status = 'active' and not exists (select 1 from public.person_logins where person_id = p_person) then
    raise exception 'not_linked';
  end if;
  update public.people set status = p_status where id = p_person;
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
  insert into public.positions (person_id, department_id, role, starts_on, ends_on)
  values (p_person, p_department, p_role, p_starts_on, p_ends_on)
  returning id into v_id;
  -- Holders of approval or finance roles must be confirmed in person.
  update public.people set needs_in_person_check = true where id = p_person;
  return v_id;
end
$$;

create or replace function public.admin_end_position(p_position uuid, p_ends_on date)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.positions set ends_on = p_ends_on where id = p_position;
  if not found then raise exception 'not_found'; end if;
end
$$;

-- People list with contact details for admins only.
create or replace function public.admin_people()
returns table (id uuid, name text, phone_e164 text, email text, status public.person_status,
               needs_in_person_check boolean, logins int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select p.id, p.name, p.phone_e164, p.email, p.status, p.needs_in_person_check,
           (select count(*)::int from public.person_logins l where l.person_id = p.id)
      from public.people p
     order by p.name;
end
$$;

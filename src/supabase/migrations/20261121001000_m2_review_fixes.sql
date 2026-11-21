-- M2 red-team fixes (doc/reviews/2026-11-21-m2-redteam.md).

-- ---------------------------------------------------------------------------
-- Notifications: claim time for safe recovery, and an explicit address for
-- notices that must go somewhere other than the person's current email.
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column claimed_at timestamptz,
  add column to_address text;

create index notifications_sending_idx on public.notifications (claimed_at) where status = 'sending';

-- Whether a claim's latest transition left an email that could not be sent.
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
       and n.kind in ('review_requested', 'finance_requested')
  )
$$;

-- ---------------------------------------------------------------------------
-- Profile: a changed email address is announced to the old address, so a
-- borrowed session cannot silently redirect "you approved" alerts.
-- ---------------------------------------------------------------------------
create or replace function public.update_my_profile(p_email text, p_mail_address text, p_legal_name_en text, p_lang text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_drafter_id();
  v_old text;
  v_new text := nullif(trim(p_email), '');
begin
  if v_me is null then raise exception 'not_member'; end if;
  if coalesce(p_lang, '') not in ('ko', 'en') then raise exception 'bad_lang'; end if;
  if v_new is not null and (v_new !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_new) > 254) then
    raise exception 'bad_email';
  end if;
  if length(coalesce(p_mail_address, '')) > 300 or length(coalesce(p_legal_name_en, '')) > 100 then
    raise exception 'too_long';
  end if;
  select email into v_old from public.people where id = v_me for update;
  -- Payee names are fixed per claim at submission, so later edits do not
  -- affect claims already in review.
  update public.people
     set email = v_new,
         mail_address = nullif(trim(p_mail_address), ''),
         legal_name_en = nullif(trim(p_legal_name_en), ''),
         lang = p_lang
   where id = v_me;
  if v_old is not null and v_old is distinct from v_new then
    insert into public.notifications (recipient_id, kind, to_address) values (v_me, 'email_changed', v_old);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Receipts: files are written only by the server (service role) after it has
-- checked the bytes, and a file is readable only through its attachment row.
-- Auditors can still read files removed from a submitted claim (D14).
-- ---------------------------------------------------------------------------
drop policy "receipts insert while draft" on storage.objects;
drop policy "receipts read when claim readable" on storage.objects;

create policy "receipts read through attachment" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      exists (select 1 from public.attachments a where a.storage_path = name and private.can_read_claim(a.claim_id))
      or ((select private.is_auditor()) and (select private.can_read_claim(private.try_uuid((storage.foldername(name))[1]))))
    )
  );

-- HEIC does not display on Android or Chrome; the phone converts it first (D17).
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 where id = 'receipts';

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
  if (select count(*) from public.attachments a where a.claim_id = p_claim) >= 20 then
    raise exception 'too_many_receipts';
  end if;

  select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
    into v_mime, v_bytes
    from storage.objects o where o.bucket_id = 'receipts' and o.name = p_storage_path;
  if not found then raise exception 'missing_object'; end if;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
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

-- The server checks the claim before uploading with the service role.
create or replace function public.can_upload_receipt_srv(p_actor_auth uuid, p_claim uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.claims c
      join public.person_logins l on l.person_id = c.author_id
      join public.people p on p.id = c.author_id
     where c.id = p_claim and c.status = 'draft'
       and l.auth_user_id = p_actor_auth and p.status in ('active', 'pending')
       and (select count(*) from public.attachments a where a.claim_id = p_claim) < 20
  )
$$;

-- remove_attachment also returns the claim id so the caller revalidates the right page.
create or replace function public.remove_attachment(p_attachment uuid)
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
  return jsonb_build_object('path', a.storage_path, 'delete_file', c.first_submitted_at is null, 'claim_id', a.claim_id);
end
$$;

-- ---------------------------------------------------------------------------
-- Stuck lists: a claim whose next person could not be emailed is shown at once.
-- ---------------------------------------------------------------------------
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
             when private.notify_failed(c.id) then 'notify_failed'
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
                 or (c.status = 'in_review' and not private.is_cleared(s.approver_id))
                 or private.notify_failed(c.id)))
        or (c.status = 'draft' and c.blocked_reason is not null)
     order by coalesce(c.blocked_at, c.updated_at);
end
$$;

create or replace function public.stuck_digest_srv()
returns table (claim_no text, department text, problem text, days_waiting int)
language sql stable security definer
set search_path = ''
as $$
  select c.claim_no, d.name,
         coalesce(c.blocked_reason,
                  case when c.status = 'in_review' and not private.is_cleared(s.approver_id) then 'approver_not_active'
                       when private.notify_failed(c.id) then 'notify_failed'
                       else 'waiting' end),
         (private.today() - private.local_date(coalesce(c.blocked_at, c.updated_at), private.church_tz()))::int
    from public.claims c
    join public.departments d on d.id = c.department_id
    left join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
   where (c.status in ('in_review', 'approved', 'received')
          and ((private.today() - private.local_date(c.updated_at, private.church_tz())) >= private.setting_int('stuck_days', 2)
               or c.blocked_reason is not null
               or (c.status = 'in_review' and not private.is_cleared(s.approver_id))
               or private.notify_failed(c.id)))
      or (c.status = 'draft' and c.blocked_reason is not null)
   order by 4 desc
$$;

-- ---------------------------------------------------------------------------
-- Admin: send only what the screen shows; allow lifting a suspension.
-- ---------------------------------------------------------------------------
drop function public.admin_people();
create function public.admin_people()
returns table (id uuid, name text, phone_last4 text, has_email boolean, status public.person_status,
               needs_in_person_check boolean, in_person_checked_at timestamptz, logins int)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select p.id, p.name, right(p.phone_e164, 4), p.email is not null, p.status, p.needs_in_person_check,
           p.in_person_checked_at,
           (select count(*)::int from public.person_logins l where l.person_id = p.id)
      from public.people p
     order by p.name;
end
$$;

create or replace function public.admin_reactivate_person(p_person uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_admin();
  p public.people%rowtype;
begin
  if p_person = v_me then raise exception 'cannot_change_self'; end if;
  select * into p from public.people where id = p_person for update;
  if not found then raise exception 'not_found'; end if;
  if p.status <> 'suspended' then raise exception 'not_suspended'; end if;
  update public.people
     set status = case
                    when not exists (select 1 from public.person_logins l where l.person_id = p_person) then 'invited'
                    when p.needs_in_person_check and p.in_person_checked_at is null then 'pending'
                    else 'active'
                  end::public.person_status
   where id = p_person;
end
$$;

-- ---------------------------------------------------------------------------
-- Review queue shows the purpose so approvers can tell claims apart.
-- ---------------------------------------------------------------------------
drop function public.my_review_queue();
create function public.my_review_queue()
returns table (claim_id uuid, claim_no text, department text, author text, purpose text, total_cents bigint,
               submitted_at timestamptz, roles text[], single_approver boolean)
language sql stable security definer
set search_path = ''
as $$
  select c.id, c.claim_no, d.name, a.name, c.purpose, c.total_cents, c.submitted_at, s.roles, c.single_approver
    from public.claims c
    join public.approval_steps s on s.claim_id = c.id and s.round = c.round and s.seq = c.current_seq
    join public.departments d on d.id = c.department_id
    join public.people a on a.id = c.author_id
   where c.status = 'in_review'
     and s.decision is null
     and s.approver_id = private.current_member_id()
   order by c.submitted_at
$$;

-- ---------------------------------------------------------------------------
-- Privileges.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
revoke execute on function private.notify_failed(uuid) from authenticated;
revoke execute on function public.add_attachment_srv(uuid, uuid, text, text, text, date, bigint),
  public.can_upload_receipt_srv(uuid, uuid) from authenticated;
grant execute on function public.add_attachment_srv(uuid, uuid, text, text, text, date, bigint),
  public.can_upload_receipt_srv(uuid, uuid) to service_role;
grant execute on function public.admin_people(), public.admin_reactivate_person(uuid), public.my_review_queue(),
  public.update_my_profile(text, text, text, text), public.remove_attachment(uuid) to authenticated;

-- Row level security. Clients (anon / authenticated) get SELECT only, through
-- policies keyed on "is an active church member" rather than "is logged in":
-- any Kakao user can log in, but only linked, active members see data.
-- All writes go through SECURITY DEFINER functions in later migrations.

-- Defense in depth: remove the default write privileges Supabase grants on public tables.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;

alter table public.app_settings    enable row level security;
alter table public.departments     enable row level security;
alter table public.people          enable row level security;
alter table public.person_logins   enable row level security;
alter table public.positions       enable row level security;
alter table public.admin_grants    enable row level security;
alter table public.invites         enable row level security;
alter table public.claim_counters  enable row level security;
alter table public.claims          enable row level security;
alter table public.claim_lines     enable row level security;
alter table public.attachments     enable row level security;
alter table public.payments        enable row level security;
alter table public.payment_claims  enable row level security;
alter table public.approval_steps  enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.notifications   enable row level security;

create policy "members read settings" on public.app_settings
  for select to authenticated using ((select private.is_member()));

create policy "members read departments" on public.departments
  for select to authenticated using ((select private.is_member()));

-- People: everyone sees names; contact columns are withheld by column grants below.
create policy "members read people" on public.people
  for select to authenticated using ((select private.is_member()));

create policy "members read positions" on public.positions
  for select to authenticated using ((select private.is_member()));

create policy "own or admin read grants" on public.admin_grants
  for select to authenticated
  using (person_id = (select private.current_member_id()) or (select private.is_admin()));

create policy "read readable claims" on public.claims
  for select to authenticated using ((select private.can_read_claim(id)));

create policy "read lines of readable claims" on public.claim_lines
  for select to authenticated using ((select private.can_read_claim(claim_id)));

create policy "read attachments of readable claims" on public.attachments
  for select to authenticated using ((select private.can_read_claim(claim_id)));

create policy "read steps of readable claims" on public.approval_steps
  for select to authenticated using ((select private.can_read_claim(claim_id)));

create policy "read payment links of readable claims" on public.payment_claims
  for select to authenticated using ((select private.can_read_claim(claim_id)));

create policy "read payments of readable claims" on public.payments
  for select to authenticated
  using (exists (
    select 1 from public.payment_claims pc
     where pc.payment_id = id and (select private.can_read_claim(pc.claim_id))
  ));

create policy "auditors read audit log" on public.audit_logs
  for select to authenticated using ((select private.is_auditor()));

-- person_logins, invites, claim_counters, notifications: no client policy (server/functions only).

-- Column-level read grants on people: contact details only through functions.
revoke select on public.people from authenticated;
grant select (id, name, legal_name_en, church_title, lang, status, created_at)
  on public.people to authenticated;

-- ---------------------------------------------------------------------------
-- Receipts bucket: private, add-only while the claim is a draft.
-- Path layout: <claim_id>/<uuid>.<ext>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy "receipts insert while draft" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (select private.can_edit_claim(private.try_uuid((storage.foldername(name))[1])))
  );

create policy "receipts read when claim readable" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (select private.can_read_claim(private.try_uuid((storage.foldername(name))[1])))
  );

create policy "receipts delete while draft" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (select private.can_edit_claim(private.try_uuid((storage.foldername(name))[1])))
  );
-- No UPDATE policy: existing receipt files can never be overwritten.

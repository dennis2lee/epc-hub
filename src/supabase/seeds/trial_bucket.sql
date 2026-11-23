-- Private bucket used only by the /trial page to test uploads from the
-- KakaoTalk in-app browser. Each user can only write and read their own folder.
-- NOT a migration: it must never reach production. Loaded locally by
-- `db reset` (config.toml seed paths) and applied by hand to the preview
-- project for the device trial (doc/kakao-trial.md). Drop it there afterwards.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trial', 'trial', false, 4194304,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy "trial insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trial' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "trial read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'trial' and (storage.foldername(name))[1] = (select auth.uid())::text);

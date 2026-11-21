-- Private bucket used only by the /trial page to test uploads from the
-- KakaoTalk in-app browser. Each user can only write and read their own folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('trial', 'trial', false, 10485760)
on conflict (id) do nothing;

create policy "trial insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trial' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "trial read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'trial' and (storage.foldername(name))[1] = (select auth.uid())::text);

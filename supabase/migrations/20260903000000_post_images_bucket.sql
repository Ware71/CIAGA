-- Social post images: the bucket the composer has always uploaded to.
--
-- components/social/PostComposer.tsx has been uploading to `post-images` since
-- the composer shipped, but the bucket was never created — every attempt failed
-- with Supabase's raw "Bucket not found". This creates it.
--
-- It also back-fills `avatars` and `group-images`, which were created by hand in
-- the Studio dashboard and exist in no migration. A fresh staging database, or a
-- sandbox after a full reset, has never had them: the only reason `avatars`
-- appears anywhere in git is that `supabase db pull` dumped its policies.
-- docs/SECURITY_AUDIT_2026-07-03.md:90-92 filed this exact gap.
--
-- Path convention is `<auth user id>/<uuid>.webp`. Note that is the AUTH user
-- id, not the CIAGA profile id — storage RLS can only see auth.uid(), and
-- matching a profile id would need a per-row subquery into public.profiles.
-- components/profile/ProfileScreen.tsx already uploads avatars this way. The
-- composer's old path was a flat `posts/<ts>_<rand>`, which carries no owner at
-- all and so cannot be secured per-user; there is no data to migrate because the
-- bucket never existed.
--
-- 3 MiB cap: the client re-encodes to WebP at a 1600px max edge before upload
-- (lib/media/compressImage.ts), which lands well under 500 KB. The cap is a
-- backstop against a caller that skips compression, not the working limit.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  3145728,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Created in Studio, never in a migration. `do nothing` so an existing project
-- keeps whatever limits it was given by hand.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('group-images', 'group-images', true)
on conflict (id) do nothing;

-- Policies mirror the avatars pair in 20260120144116_remote_schema.sql:4068-4086:
-- the first path segment must be the caller's auth uid. The `select auth.uid()`
-- subquery form is deliberate — it lets Postgres evaluate the uid once per
-- statement instead of once per row.

drop policy if exists "post_images_insert_own_folder" on storage.objects;
create policy "post_images_insert_own_folder"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (select (auth.uid())::text) = (storage.foldername(name))[1]
  );

drop policy if exists "post_images_update_own_folder" on storage.objects;
create policy "post_images_update_own_folder"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'post-images'
    and (select (auth.uid())::text) = (storage.foldername(name))[1]
  );

-- Delete matters more than it looks: the composer rolls back partially-uploaded
-- objects when one file in a batch fails, and account deletion purges the
-- author's whole folder.
drop policy if exists "post_images_delete_own_folder" on storage.objects;
create policy "post_images_delete_own_folder"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and (select (auth.uid())::text) = (storage.foldername(name))[1]
  );

-- Public read: the bucket is public and the feed renders the URLs directly.
-- Authorization on who may SEE a post is enforced on feed_items via
-- feed_item_targets, not on the object — a URL is unguessable (uuid) but not
-- secret. Anything genuinely private would need a signed URL instead.
drop policy if exists "post_images_read_public" on storage.objects;
create policy "post_images_read_public"
  on storage.objects
  as permissive
  for select
  to public
  using (bucket_id = 'post-images');

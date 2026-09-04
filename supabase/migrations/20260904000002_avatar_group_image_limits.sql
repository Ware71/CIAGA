-- Bounds and policies for the `avatars` and `group-images` buckets.
--
-- Both were created by hand in the Studio dashboard and back-filled into a
-- migration only as bare `insert … on conflict do nothing`
-- (20260903000000_post_images_bucket.sql:40-43), which deliberately left an
-- existing project's settings alone. On production that means they are still
-- carrying `file_size_limit = null` and `allowed_mime_types = null`: any type,
-- any size, publicly readable.
--
-- That is what the 2026-09 egress audit found at the bottom of a 6.483 GB
-- cached-egress month against a 5 GB allowance, on an 18 MB bucket and ten
-- monthly actives. ProfileScreen uploaded the camera original straight off the
-- picker — 3-5 MB — and it rendered at 16-96px across ~45 sites with no service
-- worker cache behind it. The client now re-encodes to ~25 KB
-- (lib/media/compressImage.ts), but nothing at the database level stopped it
-- then and nothing would stop the next caller that skips compression. These
-- limits are that backstop: a regression should fail loudly on upload rather
-- than quietly bill for a year.
--
-- ORDERING: apply this AFTER scripts/recompress-storage-images.mjs has run
-- against the same database. For an object that is already small but still
-- carrying a 1-hour Cache-Control, that script re-uploads the ORIGINAL bytes to
-- refresh the metadata — and a limit imposed first would reject exactly those
-- writes. Existing objects are otherwise untouched: a bucket limit applies to
-- new uploads, never retroactively.

-- 512 KB / 1 MB against client targets of 40 KB and 80 KB. The headroom is
-- deliberate — this is a guardrail, not the working limit, and it should not
-- start rejecting a legitimate upload from an unusual encoder.
update storage.buckets
   set file_size_limit    = 524288,
       allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'avatars';

update storage.buckets
   set file_size_limit    = 1048576,
       allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'group-images';

-- ---------------------------------------------------------------------------
-- avatars: the two policies it never had
-- ---------------------------------------------------------------------------
--
-- 20260120144116_remote_schema.sql:4066-4086 gives this bucket an own-folder
-- INSERT and an own-folder SELECT, plus an anon-select scoped to `.jpg` files
-- under a literal `public/` folder that is effectively dead (real paths are
-- `<auth uid>/<timestamp>.<ext>`). There is no UPDATE and no DELETE.
--
-- UPDATE matters because ProfileScreen.tsx uploads with `upsert: true`. Today
-- that never collides — the filename is `Date.now()` — so the gap has been
-- invisible rather than absent. DELETE lets a member clear an old avatar;
-- account deletion (api/account/delete/route.ts:99) runs as service role and
-- bypasses RLS either way.
--
-- The `select auth.uid()` subquery form is deliberate: Postgres evaluates it
-- once per statement rather than once per row.

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select (auth.uid())::text) = (storage.foldername(name))[1]
  );

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select (auth.uid())::text) = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- group-images: the policies it has never had in any migration
-- ---------------------------------------------------------------------------
--
-- Whatever permits the upload at GroupDetailClient.tsx:918 in production was
-- clicked into Studio by hand and exists in no migration, so a fresh staging
-- database or a post-reset sandbox has never had it. This writes it down.
--
-- The own-folder shape used by `avatars` and `post-images` does not apply here:
-- the path is `groups/<group id>/<file>`, which carries no uploader. Ownership
-- is the GROUP's, so the check is group membership, keyed to the role gate the
-- UI already enforces — the upload control lives inside the settings tab, which
-- renders only for `isAdminOrOwner` (GroupDetailClient.tsx:3022).
--
-- Storage RLS sees `auth.uid()`, an auth.users id, while memberships are keyed
-- by profile id, so this has to hop through `profiles.owner_user_id`.
--
-- `m.group_id::text = …` compares as text rather than casting the path segment
-- to uuid: a malformed path should fail the policy, not raise.

create or replace function public.can_write_group_image(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.major_group_memberships m
      join public.profiles p on p.id = m.profile_id
     where m.group_id::text = (storage.foldername(object_name))[2]
       and p.owner_user_id = (select auth.uid())
       and m.status = 'active'
       and m.role in ('owner', 'admin')
  );
$$;

-- SECURITY DEFINER so the policy can read major_group_memberships and profiles
-- without the caller needing its own RLS-visible path to both. Note the CLAUDE.md
-- gotcha: DROP FUNCTION + recreate resets EXECUTE grants. This uses CREATE OR
-- REPLACE, but the grant is restated below so a future drop-and-recreate is
-- caught by a failing policy rather than in production.
revoke all on function public.can_write_group_image(text) from public;
grant execute on function public.can_write_group_image(text) to authenticated;

drop policy if exists "group_images_insert_admins" on storage.objects;
create policy "group_images_insert_admins"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = 'groups'
    and public.can_write_group_image(name)
  );

drop policy if exists "group_images_update_admins" on storage.objects;
create policy "group_images_update_admins"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = 'groups'
    and public.can_write_group_image(name)
  );

drop policy if exists "group_images_delete_admins" on storage.objects;
create policy "group_images_delete_admins"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'group-images'
    and (storage.foldername(name))[1] = 'groups'
    and public.can_write_group_image(name)
  );

-- Public read: the bucket is public and group images render as plain URLs on
-- the majors hub and the home screen. Same reasoning as post-images — who may
-- SEE a group is enforced on the group rows, not on the image object.
drop policy if exists "group_images_read_public" on storage.objects;
create policy "group_images_read_public"
  on storage.objects
  as permissive
  for select
  to public
  using (bucket_id = 'group-images');

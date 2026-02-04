-- feed_item_subjects: subject index for social feed
-- Required for profile social tabs and subject-first fanout

create table if not exists public.feed_item_subjects (
  id uuid not null default gen_random_uuid(),
  feed_item_id uuid not null references public.feed_items(id) on delete cascade,
  subject_profile_id uuid not null references public.profiles(id) on delete cascade,
  role text,
  created_at timestamp with time zone not null default now(),
  constraint feed_item_subjects_pkey primary key (id)
);

create unique index if not exists feed_item_subjects_unique
  on public.feed_item_subjects(feed_item_id, subject_profile_id);

create index if not exists feed_item_subjects_subject_idx
  on public.feed_item_subjects(subject_profile_id, created_at desc);

alter table public.feed_item_subjects enable row level security;

drop policy if exists "feed_item_subjects_select_if_can_read_item" on public.feed_item_subjects;

create policy "feed_item_subjects_select_if_can_read_item"
on public.feed_item_subjects
as permissive
for select
to authenticated
using (
  subject_profile_id = public.current_profile_id()
  or exists (
    select 1
    from public.feed_item_targets t
    where t.feed_item_id = feed_item_subjects.feed_item_id
      and t.viewer_profile_id = public.current_profile_id()
  )
);

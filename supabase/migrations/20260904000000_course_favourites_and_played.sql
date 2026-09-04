-- Courses: favourites, and "courses I have played".
--
-- The Courses screen is growing from two modes (nearby / worldwide) into a set
-- of tabs, and two of them need data that does not exist yet.
--
-- 1. course_favourites — there has never been any per-user relationship to a
--    course. The only user-scoped course mechanism in the schema is
--    course_name_overrides, whose trigger function references a table no
--    migration ever creates; it is dead. This is the first real one.
--
-- 2. courses_played_by_profile() — v_course_record_rounds already answers a
--    similar question, but only for accepted = true rounds. A player who says
--    "I've played there" means any round they finished, casual ones included,
--    so filtering to WHS-acceptable scores would make courses silently absent
--    and read as a bug. This walks finished rounds instead.
--
-- No changes to courses / course_tee_boxes themselves.

-- ── 1. Favourites ────────────────────────────────────────────────────────────

create table if not exists public.course_favourites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  course_id  uuid not null references public.courses(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, course_id)
);

-- Listing a viewer's favourites is the common read; the PK already covers it.
-- This one is for the reverse ("how many people favourite this course").
create index if not exists idx_course_favourites_course
  on public.course_favourites using btree (course_id);

alter table public.course_favourites enable row level security;

-- Owner (via profiles.owner_user_id) or service_role only. Same shape as
-- notification_preferences — a favourite is private to the person who set it.
-- No update policy: a favourite has no mutable fields, you add or remove it.
drop policy if exists "course_favourites_select" on public.course_favourites;
create policy "course_favourites_select" on public.course_favourites
  for select using (
    auth.uid() = (select owner_user_id from public.profiles where id = profile_id)
    or auth.role() = 'service_role'
  );

drop policy if exists "course_favourites_insert" on public.course_favourites;
create policy "course_favourites_insert" on public.course_favourites
  for insert with check (
    auth.uid() = (select owner_user_id from public.profiles where id = profile_id)
    or auth.role() = 'service_role'
  );

drop policy if exists "course_favourites_delete" on public.course_favourites;
create policy "course_favourites_delete" on public.course_favourites
  for delete using (
    auth.uid() = (select owner_user_id from public.profiles where id = profile_id)
    or auth.role() = 'service_role'
  );

grant select, insert, delete on public.course_favourites to authenticated;
grant all on public.course_favourites to service_role;

comment on table public.course_favourites is
  'Per-player starred courses. Private to the owning profile via RLS; written through /api/courses/favourites.';

-- ── 2. Courses played ────────────────────────────────────────────────────────

-- Every finished round the profile took part in, grouped by course.
--
-- The course id is taken from the round's snapshot first and rounds.course_id
-- second: the snapshot is what the round was actually played on and survives
-- the catalogue row being re-pointed, but drafts that finished without ever
-- starting properly can lack one.
--
-- SECURITY DEFINER because it reads round_participants for the given profile;
-- callers are expected to pass their own id, and the app does.
create or replace function public.courses_played_by_profile(p_profile_id uuid)
returns table (
  course_id      uuid,
  course_name    text,
  city           text,
  country        text,
  osm_id         text,
  lat            double precision,
  lng            double precision,
  rounds_played  bigint,
  last_played_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with played as (
    select
      coalesce(rcs.source_course_id, r.course_id) as course_id,
      coalesce(r.finished_at, r.started_at, r.created_at) as played_at
    from public.round_participants rp
    join public.rounds r on r.id = rp.round_id
    left join public.round_course_snapshots rcs on rcs.round_id = r.id
    where rp.profile_id = p_profile_id
      and r.status = 'finished'
  )
  select
    c.id,
    c.name,
    c.city,
    c.country,
    c.osm_id,
    c.lat,
    c.lng,
    count(*)::bigint            as rounds_played,
    max(p.played_at)            as last_played_at
  from played p
  join public.courses c on c.id = p.course_id
  where p.course_id is not null
  group by c.id, c.name, c.city, c.country, c.osm_id, c.lat, c.lng
  order by max(p.played_at) desc nulls last;
$$;

-- DROP FUNCTION + recreate resets EXECUTE grants, so re-grant every time.
revoke all on function public.courses_played_by_profile(uuid) from public;
grant execute on function public.courses_played_by_profile(uuid) to authenticated, service_role;

comment on function public.courses_played_by_profile(uuid) is
  'Distinct courses a profile has finished a round at, newest first. Counts every finished round, not only WHS-accepted ones.';

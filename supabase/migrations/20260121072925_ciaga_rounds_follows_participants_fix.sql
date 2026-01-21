-- =====================================================
-- CIAGA ONE-TIME SECURITY + FUNCTION CLEANUP
-- =====================================================

-- -----------------------------------------------------
-- 1) REMOVE ANON ACCESS FROM ROUND-RELATED TABLES
-- -----------------------------------------------------
revoke all on table public.rounds from anon;
revoke all on table public.round_participants from anon;
revoke all on table public.round_score_events from anon;
revoke all on table public.round_hole_states from anon;
revoke all on table public.round_course_snapshots from anon;
revoke all on table public.round_tee_snapshots from anon;
revoke all on table public.round_hole_snapshots from anon;

-- -----------------------------------------------------
-- 2) ENSURE AUTHENTICATED USERS CAN READ ROUNDS + SCORES
-- -----------------------------------------------------

drop policy if exists "read" on public.rounds;
create policy "read" on public.rounds
for select
to authenticated
using (true);

drop policy if exists "read" on public.round_participants;
create policy "read" on public.round_participants
for select
to authenticated
using (true);

drop policy if exists "read" on public.round_score_events;
create policy "read" on public.round_score_events
for select
to authenticated
using (true);

drop policy if exists "read" on public.round_hole_states;
create policy "read" on public.round_hole_states
for select
to authenticated
using (true);

drop policy if exists "read" on public.round_course_snapshots;
create policy "read" on public.round_course_snapshots
for select
to authenticated
using (true);

drop policy if exists "read" on public.round_tee_snapshots;
create policy "read" on public.round_tee_snapshots
for select
to authenticated
using (true);

drop policy if exists "read" on public.round_hole_snapshots;
create policy "read" on public.round_hole_snapshots
for select
to authenticated
using (true);

-- -----------------------------------------------------
-- 3) FIX get_round_setup_participants (REMOVE EMAIL)
-- -----------------------------------------------------
-- NOTE:
-- display_name is sourced from round_participants
-- avatar_url intentionally NULL (no guessing schema)

drop function if exists public.get_round_setup_participants(uuid);

create function public.get_round_setup_participants(_round_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  avatar_url text
)
language sql
security definer
set search_path = public
as $$
  select
    rp.profile_id,
    rp.display_name,
    null::text as avatar_url
  from public.round_participants rp
  where rp.round_id = _round_id;
$$;

revoke all on function public.get_round_setup_participants(uuid) from public;
grant execute on function public.get_round_setup_participants(uuid) to authenticated;

-- -----------------------------------------------------
-- 4) STANDARDISE FOLLOWS TO PROFILE_ID
-- -----------------------------------------------------

drop policy if exists "read follows" on public.follows;
create policy "read follows" on public.follows
for select
to authenticated
using (true);

drop policy if exists "insert follow" on public.follows;
create policy "insert follow" on public.follows
for insert
to authenticated
with check (follower_id = public.current_profile_id());

drop policy if exists "delete follow" on public.follows;
create policy "delete follow" on public.follows
for delete
to authenticated
using (follower_id = public.current_profile_id());

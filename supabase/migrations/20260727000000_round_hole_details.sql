-- Shot tracking: optional per-hole detail recorded live during a round.
--
-- Players can log putts, fairway, approach dispersion, bunker and penalty count
-- while they play. Everything is opt-in: a hole can be completed with no detail,
-- and every column is independently nullable. NULL means "not recorded" — the
-- stats layer relies on that contract to compute per-stat denominators rather
-- than assuming a value for holes the player never tapped.
--
-- Grain mirrors round_hole_states: one row per (participant, hole), so the client
-- writes a plain upsert with onConflict "participant_id,hole_number".
-- RLS + realtime mirror round_wolf_picks (20260615000000) — the other per-hole
-- table that is written live by whoever is holding the phone.

create table if not exists public.round_hole_details (
  round_id          uuid    not null references public.rounds(id) on delete cascade,
  participant_id    uuid    not null references public.round_participants(id) on delete cascade,
  hole_number       integer not null,

  -- 0 putts is a real value (holed from off the green), distinct from NULL.
  putts             integer check (putts between 0 and 10),
  fairway           text    check (fairway in ('hit','left','right')),
  -- true = approach finished on the green. false = missed; the axes say where
  -- (either, both for a combination like "short left", or neither for an
  -- unspecified miss).
  approach_green    boolean,
  approach_miss_v   text    check (approach_miss_v in ('short','long')),
  approach_miss_h   text    check (approach_miss_h in ('left','right')),
  bunker            boolean,
  penalties         integer check (penalties between 0 and 10),

  updated_at        timestamptz not null default now(),
  updated_by        uuid    not null references public.profiles(id),

  primary key (participant_id, hole_number),
  constraint round_hole_details_hole_number_check check (hole_number >= 1 and hole_number <= 18),
  constraint round_hole_details_approach_coherent check (
    approach_green is not true or (approach_miss_v is null and approach_miss_h is null)
  )
);

create index if not exists idx_round_hole_details_round on public.round_hole_details using btree (round_id);

alter table public.round_hole_details enable row level security;

-- Read: any authenticated user (mirrors round_hole_states / round_wolf_picks "read").
drop policy if exists "round_hole_details: read" on public.round_hole_details;
create policy "round_hole_details: read"
  on public.round_hole_details
  for select
  to authenticated
  using (true);

-- Insert: round participants only. One person often scores for the whole group,
-- so the check is on the round, not on the target participant.
drop policy if exists "round_hole_details: participant insert" on public.round_hole_details;
create policy "round_hole_details: participant insert"
  on public.round_hole_details
  as permissive
  for insert
  to authenticated
  with check (public.is_round_participant(round_id, auth.uid()));

-- Update: round participants only.
drop policy if exists "round_hole_details: participant update" on public.round_hole_details;
create policy "round_hole_details: participant update"
  on public.round_hole_details
  as permissive
  for update
  to authenticated
  using (public.is_round_participant(round_id, auth.uid()))
  with check (public.is_round_participant(round_id, auth.uid()));

-- No delete policy: clearing a chip writes NULL, it never removes the row.
grant select, insert, update on public.round_hole_details to authenticated;
grant all on public.round_hole_details to service_role;

-- Enable Supabase Realtime (idempotent) so a second scorer's taps sync live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'round_hole_details'
  ) then
    execute 'alter publication supabase_realtime add table public.round_hole_details';
  end if;
end;
$$;

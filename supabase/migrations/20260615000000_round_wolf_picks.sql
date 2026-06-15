-- Wolf game: per-hole wolf declarations (who is the wolf, partner vs lone vs blind).
-- Picks are made live during play, so this is its own table (not format_config, which
-- is locked once a round goes live). RLS + realtime mirror round_hole_states.

create table if not exists public.round_wolf_picks (
  round_id uuid not null references public.rounds(id) on delete cascade,
  hole_number integer not null,
  wolf_participant_id uuid references public.round_participants(id) on delete set null,
  partner_participant_id uuid references public.round_participants(id) on delete set null,
  wolf_mode text not null default 'partner' check (wolf_mode in ('partner', 'lone', 'blind')),
  updated_at timestamptz not null default now(),
  primary key (round_id, hole_number),
  constraint round_wolf_picks_hole_number_check check (hole_number >= 1 and hole_number <= 18)
);

create index if not exists idx_round_wolf_picks_round on public.round_wolf_picks using btree (round_id);

alter table public.round_wolf_picks enable row level security;

-- Read: any authenticated user (mirrors round_hole_states "read").
drop policy if exists "round_wolf_picks: read" on public.round_wolf_picks;
create policy "round_wolf_picks: read"
  on public.round_wolf_picks
  for select
  to authenticated
  using (true);

-- Insert: round participants only.
drop policy if exists "round_wolf_picks: participant insert" on public.round_wolf_picks;
create policy "round_wolf_picks: participant insert"
  on public.round_wolf_picks
  as permissive
  for insert
  to authenticated
  with check (public.is_round_participant(round_id));

-- Update: round participants only.
drop policy if exists "round_wolf_picks: participant update" on public.round_wolf_picks;
create policy "round_wolf_picks: participant update"
  on public.round_wolf_picks
  as permissive
  for update
  to authenticated
  using (public.is_round_participant(round_id, auth.uid()))
  with check (public.is_round_participant(round_id, auth.uid()));

-- Enable Supabase Realtime (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'round_wolf_picks'
  ) then
    execute 'alter publication supabase_realtime add table public.round_wolf_picks';
  end if;
end;
$$;

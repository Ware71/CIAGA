-- ============================================================
-- Majors: Matchplay tables
-- matchplay_stages, matchplay_fixtures, matchplay_bracket_slots,
-- matchplay_league_table_entries
-- All tables are independent of stroke-play scoring infrastructure.
-- ============================================================

-- ── matchplay_stages ─────────────────────────────────────────
-- Defines structural stages within a matchplay competition.
-- Examples: league phase, R16, QF, SF, Final, 3rd-place playoff.
CREATE TABLE public.matchplay_stages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  stage_type     text NOT NULL
    CHECK (stage_type IN (
      'league_phase', 'group_phase',
      'round_of_16', 'quarter_final', 'semi_final', 'final',
      'placement', 'custom'
    )),
  name           text NOT NULL,
  sort_order     integer NOT NULL DEFAULT 0,
  group_label    text,              -- e.g. "Division A", "Group 1"
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matchplay_stages_competition ON public.matchplay_stages(competition_id);

ALTER TABLE public.matchplay_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matchplay_stages_select"
  ON public.matchplay_stages FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.matchplay_stages TO authenticated;
GRANT ALL ON public.matchplay_stages TO service_role;

-- ── matchplay_fixtures ────────────────────────────────────────
-- Represents one match between two competition entries.
CREATE TABLE public.matchplay_fixtures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id        uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  stage_id              uuid REFERENCES public.matchplay_stages(id) ON DELETE SET NULL,
  round_number          integer,
  home_entry_id         uuid REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  away_entry_id         uuid REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  scheduled_at          timestamptz,
  status                text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'completed', 'walkover', 'cancelled')),
  result_type           text
    CHECK (result_type IN (
      'home_win', 'away_win', 'halved',
      'walkover_home', 'walkover_away', 'double_withdrawal'
    )),
  winning_entry_id      uuid REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  margin_holes          integer,       -- e.g. 3 in "3&2"
  holes_remaining       integer,       -- e.g. 2 in "3&2"
  extra_holes_played    integer,
  approved_at           timestamptz,
  approved_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes                 text
);

CREATE INDEX idx_matchplay_fixtures_competition ON public.matchplay_fixtures(competition_id);
CREATE INDEX idx_matchplay_fixtures_stage ON public.matchplay_fixtures(stage_id);
CREATE INDEX idx_matchplay_fixtures_status ON public.matchplay_fixtures(competition_id, status);

ALTER TABLE public.matchplay_fixtures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matchplay_fixtures_select"
  ON public.matchplay_fixtures FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.matchplay_fixtures TO authenticated;
GRANT ALL ON public.matchplay_fixtures TO service_role;

-- ── matchplay_bracket_slots ───────────────────────────────────
-- Tracks bracket structure and slot-to-entry advancement for knockout competitions.
CREATE TABLE public.matchplay_bracket_slots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id    uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  stage_id          uuid NOT NULL REFERENCES public.matchplay_stages(id) ON DELETE CASCADE,
  fixture_id        uuid NOT NULL REFERENCES public.matchplay_fixtures(id) ON DELETE CASCADE,
  slot_number       integer NOT NULL CHECK (slot_number IN (1, 2)),
  source_type       text NOT NULL
    CHECK (source_type IN ('entry', 'winner_of_fixture', 'loser_of_fixture', 'bye')),
  source_entry_id   uuid REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  source_fixture_id uuid REFERENCES public.matchplay_fixtures(id) ON DELETE SET NULL
);

CREATE INDEX idx_bracket_slots_competition ON public.matchplay_bracket_slots(competition_id);
CREATE INDEX idx_bracket_slots_fixture ON public.matchplay_bracket_slots(fixture_id);

ALTER TABLE public.matchplay_bracket_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matchplay_bracket_slots_select"
  ON public.matchplay_bracket_slots FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.matchplay_bracket_slots TO authenticated;
GRANT ALL ON public.matchplay_bracket_slots TO service_role;

-- ── matchplay_league_table_entries ───────────────────────────
-- Precomputed league standings for league-format matchplay.
CREATE TABLE public.matchplay_league_table_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id   uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  stage_id         uuid REFERENCES public.matchplay_stages(id) ON DELETE SET NULL,
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  played           integer NOT NULL DEFAULT 0,
  won              integer NOT NULL DEFAULT 0,
  halved           integer NOT NULL DEFAULT 0,
  lost             integer NOT NULL DEFAULT 0,
  league_points    numeric NOT NULL DEFAULT 0,
  matches_for      integer,     -- optional total holes/points won
  matches_against  integer,
  position         integer,
  last_computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mlte_competition ON public.matchplay_league_table_entries(competition_id);
CREATE INDEX idx_mlte_stage ON public.matchplay_league_table_entries(stage_id);

ALTER TABLE public.matchplay_league_table_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matchplay_league_table_select"
  ON public.matchplay_league_table_entries FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.matchplay_league_table_entries TO authenticated;
GRANT ALL ON public.matchplay_league_table_entries TO service_role;

-- ── competition_entries: ensure table has correct structure ───
-- The spec requires competition_entries to track entries into competitions.
-- The existing table may have been created by the legacy system.
-- Add columns if missing.
ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS entry_status text NOT NULL DEFAULT 'entered'
    CHECK (entry_status IN ('entered', 'pending_approval', 'approved', 'waitlisted', 'withdrawn', 'rejected', 'no_show')),
  ADD COLUMN IF NOT EXISTS assigned_handicap_index numeric,
  ADD COLUMN IF NOT EXISTS seed integer,
  ADD COLUMN IF NOT EXISTS entered_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ============================================================================
-- Round Formats, Playing Handicap, and Team Support
-- ============================================================================
-- This migration adds comprehensive support for:
-- 1. Multiple round formats (strokeplay, stableford, matchplay, team variants, etc.)
-- 2. Configurable playing handicaps (with round-level defaults and per-participant overrides)
-- 3. Team-based rounds
-- 4. Side games (skins, wolf, etc.)
--
-- CRITICAL INVARIANT:
-- Manual playing handicap overrides are for SCORING/DISPLAY ONLY and must NEVER
-- be used in official handicap calculations (AGS, score differential, HI).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Create ENUMs for type safety
-- ----------------------------------------------------------------------------

-- Round format types
CREATE TYPE public.round_format_type AS ENUM (
  'strokeplay',
  'stableford',
  'matchplay',
  'team_strokeplay',
  'team_stableford',
  'team_bestball',
  'scramble',
  'greensomes',
  'foursomes',
  'skins',
  'wolf'
);

-- Playing handicap calculation modes
CREATE TYPE public.playing_handicap_mode AS ENUM (
  'none',           -- No handicap (gross scoring only)
  'allowance_pct',  -- Percentage of course handicap (e.g., 100%, 85%, 90%)
  'fixed'           -- Fixed playing handicap value
);

COMMENT ON TYPE public.playing_handicap_mode IS
  'Handicap modes: none = gross only, allowance_pct = % of course handicap, fixed = absolute value';

-- ----------------------------------------------------------------------------
-- 2. Extend rounds table with format and handicap configuration
-- ----------------------------------------------------------------------------

ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS
  format_type public.round_format_type DEFAULT 'strokeplay' NOT NULL;

ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS
  format_config jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS
  side_games jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS
  scheduled_at timestamptz;

ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS
  default_playing_handicap_mode public.playing_handicap_mode DEFAULT 'allowance_pct' NOT NULL;

ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS
  default_playing_handicap_value numeric DEFAULT 100 NOT NULL;

-- Add constraint to validate mode/value combinations
ALTER TABLE public.rounds ADD CONSTRAINT rounds_handicap_mode_value_check CHECK (
  (default_playing_handicap_mode = 'none' AND default_playing_handicap_value = 0) OR
  (default_playing_handicap_mode = 'allowance_pct' AND default_playing_handicap_value BETWEEN 0 AND 100) OR
  (default_playing_handicap_mode = 'fixed' AND default_playing_handicap_value >= 0)
);

-- Add index for scheduled rounds queries
CREATE INDEX IF NOT EXISTS idx_rounds_scheduled
  ON public.rounds(scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status = 'scheduled';

-- Comments for documentation
COMMENT ON COLUMN public.rounds.format_type IS
  'Primary format for the round (strokeplay, stableford, matchplay, etc.)';

COMMENT ON COLUMN public.rounds.format_config IS
  'Format-specific configuration (e.g., stableford points table, team settings, match play rules)';

COMMENT ON COLUMN public.rounds.side_games IS
  'Array of enabled side games with their configurations (e.g., skins carryover rules, wolf stakes)';

COMMENT ON COLUMN public.rounds.default_playing_handicap_mode IS
  'How to calculate playing handicap for participants (none, allowance_pct, or fixed)';

COMMENT ON COLUMN public.rounds.default_playing_handicap_value IS
  'Value for handicap calculation: % for allowance_pct mode, absolute value for fixed mode, 0 for none';

-- ----------------------------------------------------------------------------
-- 3. Create round_teams table for team-based formats
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.round_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  name text NOT NULL,
  team_number integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(round_id, team_number)
);

CREATE INDEX IF NOT EXISTS idx_round_teams_round
  ON public.round_teams(round_id);

ALTER TABLE public.round_teams ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.round_teams IS
  'Teams for team-based round formats (scramble, best ball, etc.)';

-- ----------------------------------------------------------------------------
-- 4. Extend round_participants with handicap and team fields
-- ----------------------------------------------------------------------------

-- Manual override for playing handicap (scoring only - NEVER used in AGS/HI calculations)
ALTER TABLE public.round_participants ADD COLUMN IF NOT EXISTS
  assigned_playing_handicap integer;

-- Resolved playing handicap persisted at round start (locked snapshot)
ALTER TABLE public.round_participants ADD COLUMN IF NOT EXISTS
  playing_handicap_used integer;

-- Course handicap (100% allowance) persisted at round start (locked snapshot)
ALTER TABLE public.round_participants ADD COLUMN IF NOT EXISTS
  course_handicap_used integer;

-- Team assignment for team formats
ALTER TABLE public.round_participants ADD COLUMN IF NOT EXISTS
  team_id uuid REFERENCES public.round_teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_round_participants_team
  ON public.round_participants(team_id)
  WHERE team_id IS NOT NULL;

-- Comments for critical invariants
COMMENT ON COLUMN public.round_participants.assigned_playing_handicap IS
  'SCORING ONLY: Manual override for playing handicap. NEVER used in AGS or handicap index calculations.';

COMMENT ON COLUMN public.round_participants.playing_handicap_used IS
  'Locked snapshot: Resolved playing handicap at round start (from formula or manual override). Used for format scoring.';

COMMENT ON COLUMN public.round_participants.course_handicap_used IS
  'Locked snapshot: Course handicap (100% allowance) at round start. Used for official AGS and handicap calculations.';

-- ----------------------------------------------------------------------------
-- 5. Create result storage tables for format scores and side games
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.round_format_results (
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.round_participants(id) ON DELETE CASCADE,
  format_type public.round_format_type NOT NULL,
  result_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (round_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_round_format_results_round
  ON public.round_format_results(round_id);

ALTER TABLE public.round_format_results ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.round_format_results IS
  'Computed format-specific results (e.g., stableford points, match play outcomes, team scores)';

COMMENT ON COLUMN public.round_format_results.result_data IS
  'Format-specific result data (e.g., {"stableford_points": 36, "holes": [...]} or {"match_result": "won", "holes_up": 2})';

-- Side game results
CREATE TABLE IF NOT EXISTS public.round_sidegame_results (
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.round_participants(id) ON DELETE CASCADE,
  game_name text NOT NULL,
  result_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (round_id, participant_id, game_name)
);

CREATE INDEX IF NOT EXISTS idx_round_sidegame_results_round
  ON public.round_sidegame_results(round_id);

ALTER TABLE public.round_sidegame_results ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.round_sidegame_results IS
  'Side game results (skins, wolf, etc.) calculated per participant';

-- ----------------------------------------------------------------------------
-- 6. SQL Functions for playing handicap resolution
-- ----------------------------------------------------------------------------

-- Resolve playing handicap for a participant (for FORMAT SCORING only)
CREATE OR REPLACE FUNCTION public.ciaga_resolve_playing_handicap(
  p_round_id uuid,
  p_participant_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    -- 1. Manual override takes precedence (if set)
    rp.assigned_playing_handicap,

    -- 2. Otherwise, use round default calculation
    CASE r.default_playing_handicap_mode
      WHEN 'fixed' THEN
        r.default_playing_handicap_value::integer

      WHEN 'allowance_pct' THEN
        COALESCE(
          round(
            -- Compute course handicap from HI + slope/rating, then apply allowance %
            (
              (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
              + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
            ) * r.default_playing_handicap_value / 100.0
          )::integer,
          0
        )

      ELSE 0  -- 'none' mode or NULL
    END,

    0  -- Fallback to 0 if everything is NULL
  )
  FROM public.round_participants rp
  JOIN public.rounds r ON r.id = rp.round_id
  LEFT JOIN public.round_tee_snapshots rts ON rts.id = rp.tee_snapshot_id
  WHERE rp.round_id = p_round_id
    AND rp.id = p_participant_id;
$$;

COMMENT ON FUNCTION public.ciaga_resolve_playing_handicap IS
  'SCORING ONLY: Resolves playing handicap from manual override or round default formula.
   NEVER use this for AGS or handicap index calculations - use course_handicap_used instead.';

-- Persist resolved handicaps at round start (creates locked snapshots)
CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.round_participants rp
  SET
    -- Persist course handicap (100% allowance) for official handicap calculations
    course_handicap_used = COALESCE(
      round(
        (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
        + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
      )::integer,
      0
    ),

    -- Persist resolved playing handicap for format scoring
    playing_handicap_used = public.ciaga_resolve_playing_handicap(p_round_id, rp.id)
  FROM public.round_tee_snapshots rts
  WHERE rp.round_id = p_round_id
    AND rts.id = rp.tee_snapshot_id;
END;
$$;

COMMENT ON FUNCTION public.ciaga_persist_playing_handicaps IS
  'Called at round start to lock handicap snapshots. Prevents mid-round drift from HI/tee changes.
   Persists both course_handicap_used (for AGS) and playing_handicap_used (for format scoring).';

-- ----------------------------------------------------------------------------
-- 7. Add critical invariant check to compute_handicap_round_result
-- ----------------------------------------------------------------------------

-- Add comment to existing function documenting the invariant
COMMENT ON FUNCTION public.compute_handicap_round_result IS
  'CRITICAL INVARIANT: This function MUST use only course_handicap_used (100% allowance)
   for AGS and score differential calculations. NEVER read assigned_playing_handicap or
   playing_handicap_used for official handicap math. Those fields are for format scoring only.

   The function currently uses rp.handicap_index for HI snapshot, which is correct.
   Course handicap is computed from HI + slope/rating (100% allowance).';

-- ----------------------------------------------------------------------------
-- 8. RLS Policies for new tables
-- ----------------------------------------------------------------------------

-- round_teams: participants can view teams in their rounds
CREATE POLICY "round_teams: read for round participants"
  ON public.round_teams
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.round_participants rp
      WHERE rp.round_id = round_teams.round_id
        AND rp.profile_id = public.current_profile_id()
    )
  );

-- round_format_results: participants can view results
CREATE POLICY "round_format_results: read for round participants"
  ON public.round_format_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.round_participants rp
      WHERE rp.round_id = round_format_results.round_id
        AND rp.profile_id = public.current_profile_id()
    )
  );

-- round_sidegame_results: participants can view results
CREATE POLICY "round_sidegame_results: read for round participants"
  ON public.round_sidegame_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.round_participants rp
      WHERE rp.round_id = round_sidegame_results.round_id
        AND rp.profile_id = public.current_profile_id()
    )
  );

-- Grant permissions
GRANT SELECT ON public.round_teams TO authenticated;
GRANT SELECT ON public.round_format_results TO authenticated;
GRANT SELECT ON public.round_sidegame_results TO authenticated;

-- Service role needs full access for backend operations
GRANT ALL ON public.round_teams TO service_role;
GRANT ALL ON public.round_format_results TO service_role;
GRANT ALL ON public.round_sidegame_results TO service_role;

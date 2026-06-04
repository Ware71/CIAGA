-- ============================================================
-- Group season standings
--
-- Extends group_seasons with standings and label fields so it
-- mirrors competition_seasons in the data needed for the UI.
-- Adds group_season_standings_entries table and a compute
-- function that aggregates across all competitions in the group.
-- ============================================================

-- ── 1. Extend group_seasons ──────────────────────────────────
ALTER TABLE public.group_seasons
  ADD COLUMN IF NOT EXISTS season_type text NOT NULL DEFAULT 'calendar_year'
    CHECK (season_type IN ('calendar_year', 'custom')),
  ADD COLUMN IF NOT EXISTS season_year integer,
  ADD COLUMN IF NOT EXISTS season_label text,
  ADD COLUMN IF NOT EXISTS standings_model text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ── 2. Back-fill label + year for existing rows ───────────────
UPDATE public.group_seasons
SET
  season_label = to_char(start_date, 'YYYY'),
  season_year  = EXTRACT(YEAR FROM start_date)::integer
WHERE season_label IS NULL;

-- ── 3. Reuse existing ciaga_set_season_label trigger ─────────
--    The function reads NEW.season_type / season_year / season_label
--    / start_date / end_date — all now present on group_seasons.
CREATE TRIGGER trg_group_season_label_before_insert_update
  BEFORE INSERT OR UPDATE ON public.group_seasons
  FOR EACH ROW EXECUTE FUNCTION public.ciaga_set_season_label();

-- ── 4. group_season_standings_entries table ───────────────────
CREATE TABLE public.group_season_standings_entries (
  group_season_id  uuid NOT NULL REFERENCES public.group_seasons(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position         integer,
  season_points    numeric NOT NULL DEFAULT 0,
  events_played    integer NOT NULL DEFAULT 0,
  wins             integer NOT NULL DEFAULT 0,
  top_3s           integer NOT NULL DEFAULT 0,
  best_finish      integer,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_season_id, profile_id)
);

CREATE INDEX idx_gsse_group_season_pos ON public.group_season_standings_entries(group_season_id, position);
CREATE INDEX idx_gsse_profile ON public.group_season_standings_entries(profile_id);

ALTER TABLE public.group_season_standings_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_season_standings_entries_select"
  ON public.group_season_standings_entries FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.group_season_standings_entries TO authenticated;
GRANT ALL ON public.group_season_standings_entries TO service_role;

-- ── 5. ciaga_compute_group_season_standings ───────────────────
-- Aggregates event_leaderboard_entries for all events in the
-- group season (via events.group_season_id) and writes positions
-- into group_season_standings_entries.
CREATE OR REPLACE FUNCTION public.ciaga_compute_group_season_standings(p_group_season_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM group_season_standings_entries
  WHERE group_season_id = p_group_season_id;

  INSERT INTO group_season_standings_entries
    (group_season_id, profile_id, season_points, events_played, wins, top_3s, best_finish, position, last_computed_at)
  SELECT
    p_group_season_id,
    agg.profile_id,
    COALESCE(SUM(agg.points_earned), 0)                           AS season_points,
    COUNT(DISTINCT agg.event_id)::integer                         AS events_played,
    COUNT(*) FILTER (WHERE agg.position = 1)::integer             AS wins,
    COUNT(*) FILTER (WHERE agg.position <= 3)::integer            AS top_3s,
    MIN(agg.position)                                             AS best_finish,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(SUM(agg.points_earned), 0) DESC,
        COUNT(*) FILTER (WHERE agg.position = 1) DESC,
        COUNT(*) FILTER (WHERE agg.position <= 3) DESC
    )::integer AS position,
    NOW() AS last_computed_at
  FROM event_leaderboard_entries agg
  JOIN events e ON e.id = agg.event_id
  WHERE e.group_season_id = p_group_season_id
    AND e.standings_contribution IN ('season', 'both')
    AND e.majors_status IN ('completed', 'official')
  GROUP BY agg.profile_id;
END;
$$;

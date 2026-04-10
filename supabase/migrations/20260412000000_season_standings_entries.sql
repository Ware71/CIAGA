-- ============================================================
-- Majors: season_standings_entries and compute_season_standings
-- Season-scoped standings keyed by season_id (not group_id).
-- The legacy major_group_standings table is preserved for the
-- group-level summary views; this table is the spec-compliant
-- replacement for season-aware standings.
-- ============================================================

-- ── season_standings_entries table ───────────────────────────
CREATE TABLE public.season_standings_entries (
  season_id        uuid NOT NULL REFERENCES public.series_seasons(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position         integer,
  season_points    numeric NOT NULL DEFAULT 0,
  events_played    integer NOT NULL DEFAULT 0,
  wins             integer NOT NULL DEFAULT 0,
  top_3s           integer NOT NULL DEFAULT 0,
  best_finish      integer,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, profile_id)
);

CREATE INDEX idx_sse_season_pos ON public.season_standings_entries(season_id, position);
CREATE INDEX idx_sse_profile ON public.season_standings_entries(profile_id);

ALTER TABLE public.season_standings_entries ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated user (standings are not secret)
CREATE POLICY "season_standings_entries_select"
  ON public.season_standings_entries FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.season_standings_entries TO authenticated;
GRANT ALL ON public.season_standings_entries TO service_role;

-- ── ciaga_compute_season_standings function ───────────────────
-- Aggregates competition leaderboard entries for all competitions
-- within a season and writes to season_standings_entries.
CREATE OR REPLACE FUNCTION public.ciaga_compute_season_standings(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_standings_model text;
BEGIN
  SELECT standings_model::text INTO v_standings_model
  FROM series_seasons
  WHERE id = p_season_id;

  DELETE FROM season_standings_entries
  WHERE season_id = p_season_id;

  INSERT INTO season_standings_entries
    (season_id, profile_id, season_points, events_played, wins, top_3s, best_finish, position, last_computed_at)
  SELECT
    p_season_id,
    agg.profile_id,
    COALESCE(SUM(agg.points_earned), 0)                         AS season_points,
    COUNT(DISTINCT agg.competition_id)::integer                 AS events_played,
    COUNT(*) FILTER (WHERE agg.position = 1)::integer           AS wins,
    COUNT(*) FILTER (WHERE agg.position <= 3)::integer          AS top_3s,
    MIN(agg.position)                                           AS best_finish,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(SUM(agg.points_earned), 0) DESC,
        COUNT(*) FILTER (WHERE agg.position = 1) DESC,
        COUNT(*) FILTER (WHERE agg.position <= 3) DESC
    )::integer AS position,
    NOW() AS last_computed_at
  FROM competition_leaderboard_entries agg
  JOIN competitions c ON c.id = agg.competition_id
  WHERE c.season_id = p_season_id
    AND c.standings_contribution IN ('season', 'both')
    AND c.majors_status IN ('completed', 'official')
  GROUP BY agg.profile_id;
END;
$$;

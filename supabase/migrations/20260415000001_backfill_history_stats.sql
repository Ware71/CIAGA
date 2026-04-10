-- ============================================================
-- Majors: Backfill history and stats tables
-- Populates event_history_summaries, profile_competition_stats,
-- and series_seasons from existing completed competition data.
-- Run once after deploying the history_stats_tables migration.
-- ============================================================

-- ── 1. Backfill series_seasons from existing competitions ─────
-- Create season rows for each distinct (series_id, competition_year) pair.
INSERT INTO series_seasons (series_id, season_year, name, status, standings_model)
SELECT DISTINCT
  c.series_id,
  c.competition_year,
  cs.name || ' ' || c.competition_year::text AS name,
  'completed' AS status,
  'season_points'::standings_model AS standings_model
FROM competitions c
JOIN competition_series cs ON cs.id = c.series_id
WHERE c.series_id IS NOT NULL
  AND c.competition_year IS NOT NULL
ON CONFLICT (series_id, season_year) DO NOTHING;

-- Back-link competitions to their newly created seasons
UPDATE competitions c
SET season_id = ss.id
FROM series_seasons ss
WHERE c.series_id = ss.series_id
  AND c.competition_year = ss.season_year
  AND c.season_id IS NULL;

-- ── 2. Backfill event_history_summaries ───────────────────────
-- For all completed/official competitions with a series_event_template_id
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM competitions
    WHERE series_event_template_id IS NOT NULL
      AND competition_year IS NOT NULL
      AND majors_status IN ('completed', 'official', 'live')
  LOOP
    PERFORM ciaga_refresh_event_history_summary(v_id);
  END LOOP;
END;
$$;

-- ── 3. Backfill profile_competition_stats ─────────────────────
-- For all profiles that have leaderboard entries
DO $$
DECLARE
  v_pid uuid;
BEGIN
  FOR v_pid IN
    SELECT DISTINCT profile_id FROM competition_leaderboard_entries
    WHERE profile_id IS NOT NULL
  LOOP
    PERFORM ciaga_refresh_profile_stats(v_pid);
  END LOOP;
END;
$$;

-- ============================================================
-- Fix: ciaga_compute_group_standings was only aggregating
-- competitions with majors_status = 'completed', causing the
-- group/season leaderboard to show 0 pts for everyone while
-- a competition is live.
--
-- Mirror the fix already applied to ciaga_compute_season_standings
-- in 20260514000006:
--   • Widen status filter to IN ('live', 'completed', 'official')
--   • Add AND agg.net_score IS NOT NULL to exclude registered
--     players who haven't scored yet (prevents phantom 0-pt rows)
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_compute_group_standings(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM major_group_standings
  WHERE group_id = p_group_id;

  INSERT INTO major_group_standings
    (group_id, profile_id, season_points, events_played, wins, position, computed_at)
  SELECT
    p_group_id,
    agg.profile_id,
    COALESCE(SUM(agg.points_earned), 0)               AS season_points,
    COUNT(DISTINCT agg.competition_id)::integer        AS events_played,
    COUNT(*) FILTER (WHERE agg.position = 1)::integer  AS wins,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(SUM(agg.points_earned), 0) DESC,
               COUNT(*) FILTER (WHERE agg.position = 1) DESC
    )::integer AS position,
    NOW()
  FROM competition_leaderboard_entries agg
  JOIN competitions c ON c.id = agg.competition_id
  WHERE c.group_id = p_group_id
    AND c.standings_contribution IN ('season', 'both')
    AND c.majors_status IN ('live', 'completed', 'official')
    AND agg.net_score IS NOT NULL
  GROUP BY agg.profile_id;
END;
$$;

-- Backfill all groups that have live/completed/official competitions
DO $$
DECLARE
  g_id uuid;
BEGIN
  FOR g_id IN
    SELECT DISTINCT c.group_id
    FROM public.competitions c
    WHERE c.group_id IS NOT NULL
      AND c.majors_status IN ('live', 'completed', 'official')
      AND c.standings_contribution IN ('season', 'both')
  LOOP
    PERFORM public.ciaga_compute_group_standings(g_id);
  END LOOP;
END;
$$;

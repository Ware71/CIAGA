-- ============================================================
-- Standings must respect playoff-resolved positions.
--
-- After a 1st-place playoff, the loser keeps position = 1 on
-- event_leaderboard_entries (the pre-playoff tie) with the real
-- outcome stored in playoff_final_position. Both standings
-- functions counted wins / top-3s / best finish from raw
-- `position`, so a playoff LOSER still rolled up as a win
-- (e.g. The Invitational 2026: Jack Wilson lost the playoff but
-- showed "1W" on the group season standings).
--
-- Fix: use COALESCE(playoff_final_position, position) as the
-- effective finishing position in:
--   • ciaga_compute_group_season_standings  (group_season_standings_entries)
--   • ciaga_compute_group_standings         (major_group_standings)
--
-- Note: an UNRESOLVED 1st-place tie (no playoff yet) still counts
-- a win for each tied player — transient by design; it corrects
-- itself as soon as the tie is resolved.
-- ============================================================

-- ── 1. Group season standings ─────────────────────────────────
-- Base: 20260604000001_group_seasons_standings.sql
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
    COUNT(*) FILTER (WHERE COALESCE(agg.playoff_final_position, agg.position) = 1)::integer  AS wins,
    COUNT(*) FILTER (WHERE COALESCE(agg.playoff_final_position, agg.position) <= 3)::integer AS top_3s,
    MIN(COALESCE(agg.playoff_final_position, agg.position))       AS best_finish,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(SUM(agg.points_earned), 0) DESC,
        COUNT(*) FILTER (WHERE COALESCE(agg.playoff_final_position, agg.position) = 1) DESC,
        COUNT(*) FILTER (WHERE COALESCE(agg.playoff_final_position, agg.position) <= 3) DESC
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

-- ── 2. Group standings ────────────────────────────────────────
-- Base: 20260521000001_fix_group_standings_live.sql (post-rename names,
-- as rewritten in prod by 20260528004504's function-body substitution).
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
    COUNT(DISTINCT agg.event_id)::integer              AS events_played,
    COUNT(*) FILTER (WHERE COALESCE(agg.playoff_final_position, agg.position) = 1)::integer AS wins,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(SUM(agg.points_earned), 0) DESC,
               COUNT(*) FILTER (WHERE COALESCE(agg.playoff_final_position, agg.position) = 1) DESC
    )::integer AS position,
    NOW()
  FROM event_leaderboard_entries agg
  JOIN events e ON e.id = agg.event_id
  WHERE e.group_id = p_group_id
    AND e.standings_contribution IN ('season', 'both')
    AND e.majors_status IN ('live', 'completed', 'official')
    AND agg.net_score IS NOT NULL
  GROUP BY agg.profile_id;
END;
$$;

-- ── 3. Backfill: recompute all existing standings ─────────────
DO $$
DECLARE
  g_id uuid;
  gs_id uuid;
BEGIN
  FOR g_id IN
    SELECT DISTINCT e.group_id
    FROM public.events e
    WHERE e.group_id IS NOT NULL
      AND e.majors_status IN ('live', 'completed', 'official')
      AND e.standings_contribution IN ('season', 'both')
  LOOP
    PERFORM public.ciaga_compute_group_standings(g_id);
  END LOOP;

  FOR gs_id IN
    SELECT DISTINCT e.group_season_id
    FROM public.events e
    WHERE e.group_season_id IS NOT NULL
      AND e.majors_status IN ('completed', 'official')
      AND e.standings_contribution IN ('season', 'both')
  LOOP
    PERFORM public.ciaga_compute_group_season_standings(gs_id);
  END LOOP;
END;
$$;

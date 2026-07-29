-- ============================================================
-- Season standings must respect the ceremony freeze.
--
-- Nothing in the season/standings stack read leaderboard_freeze_state or
-- event_player_freeze_snapshots — freeze awareness lived only in the
-- event-scoped payload builder. So while an event's leaderboard hid the
-- last N holes, the Season tab happily showed the real thing:
--
--   ciaga_compute_group_standings includes majors_status = 'live', and for
--   a live event event_leaderboard_entries is a MERGED submitted +
--   in-progress table. Every score event therefore republished the frozen
--   event's true position and points into major_group_standings.
--
-- Fix: for an event whose leaderboard is frozen, standings source each
-- frozen player's position and points from their freeze snapshot — the
-- same thru-N picture the event leaderboard shows. Players who haven't
-- crossed the threshold have no snapshot and keep updating live, exactly
-- as they do on the event leaderboard.
--
-- The snapshot didn't carry points_earned, so this adds it, captured the
-- same way every other snapshot column is: whatever the value was at the
-- moment the player crossed the line.
--
-- ciaga_compute_group_season_standings needs no change — it only accepts
-- 'completed'/'official', and 20260729000001's companion TS fix
-- (reconcileEventStatus) stops a frozen event reaching those states.
-- ============================================================

-- ── 1. Snapshot carries points ────────────────────────────────
ALTER TABLE public.event_player_freeze_snapshots
  ADD COLUMN IF NOT EXISTS points_earned numeric;

-- Best-effort backfill for snapshots already on disk. For a revealed event
-- the live entry IS the final truth, so this is exact; for one still frozen
-- it is the closest available value.
UPDATE public.event_player_freeze_snapshots pfs
SET points_earned = cle.points_earned
FROM public.event_leaderboard_entries cle
WHERE cle.event_id = pfs.event_id
  AND cle.profile_id = pfs.profile_id
  AND pfs.points_earned IS NULL;

-- ── 2. Both freeze triggers capture it ────────────────────────
-- Base: 20260529000005_freeze_snapshot_format_points.sql. Only the column
-- list and VALUES change.
CREATE OR REPLACE FUNCTION public.ciaga_on_freeze_state_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_threshold integer;
BEGIN
  IF NEW.leaderboard_freeze_state IS DISTINCT FROM 'frozen' THEN
    RETURN NEW;
  END IF;
  IF OLD.leaderboard_freeze_state = 'frozen' THEN
    RETURN NEW;
  END IF;
  IF NEW.leaderboard_freeze_last_holes IS NULL THEN
    RETURN NEW;
  END IF;

  v_threshold := COALESCE(NEW.num_rounds, 1) * 18 - NEW.leaderboard_freeze_last_holes;

  BEGIN
    INSERT INTO public.event_player_freeze_snapshots
      (event_id, profile_id, gross_score, net_score, to_par, format_points,
       points_earned, holes_shown, actual_holes_completed, is_live, position)
    SELECT
      cle.event_id,
      cle.profile_id,
      cle.gross_score,
      cle.net_score,
      cle.to_par,
      cle.format_points,
      cle.points_earned,
      v_threshold,
      cle.holes_completed,
      cle.is_live,
      cle.position
    FROM public.event_leaderboard_entries cle
    WHERE cle.event_id = NEW.id
      AND cle.holes_completed >= v_threshold
    ON CONFLICT (event_id, profile_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Never block the freeze transition on a snapshot failure.
    NULL;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ciaga_auto_snapshot_on_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_freeze_state      text;
  v_freeze_last_holes integer;
  v_num_rounds        integer;
  v_threshold         integer;
BEGIN
  SELECT leaderboard_freeze_state, leaderboard_freeze_last_holes, num_rounds
    INTO v_freeze_state, v_freeze_last_holes, v_num_rounds
  FROM public.events
  WHERE id = NEW.event_id;

  IF v_freeze_state IS DISTINCT FROM 'frozen' OR v_freeze_last_holes IS NULL THEN
    RETURN NEW;
  END IF;

  v_threshold := COALESCE(v_num_rounds, 1) * 18 - v_freeze_last_holes;

  IF NEW.holes_completed < v_threshold THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.event_player_freeze_snapshots
    (event_id, profile_id, gross_score, net_score, to_par, format_points,
     points_earned, holes_shown, actual_holes_completed, is_live, position)
  VALUES
    (NEW.event_id, NEW.profile_id,
     NEW.gross_score, NEW.net_score, NEW.to_par, NEW.format_points,
     NEW.points_earned,
     v_threshold,
     NEW.holes_completed,
     NEW.is_live, NEW.position)
  ON CONFLICT (event_id, profile_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── 3. Group standings mask frozen events ─────────────────────
-- Base: 20260610000006_standings_respect_playoff_positions.sql. The source
-- of position/points becomes snapshot-first for frozen events.
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
    COALESCE(SUM(m.points_earned), 0)                          AS season_points,
    COUNT(DISTINCT agg.event_id)::integer                      AS events_played,
    COUNT(*) FILTER (WHERE m.position = 1)::integer            AS wins,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(SUM(m.points_earned), 0) DESC,
               COUNT(*) FILTER (WHERE m.position = 1) DESC
    )::integer AS position,
    NOW()
  FROM event_leaderboard_entries agg
  JOIN events e ON e.id = agg.event_id
  -- Only matches while the event is frozen AND this player has crossed the
  -- threshold. Below-threshold players have no snapshot and stay live, which
  -- is exactly how the event leaderboard treats them.
  LEFT JOIN event_player_freeze_snapshots pfs
    ON pfs.event_id = agg.event_id
   AND pfs.profile_id = agg.profile_id
   AND COALESCE(e.leaderboard_freeze_state, 'live') = 'frozen'
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN pfs.profile_id IS NOT NULL
           THEN pfs.points_earned
           ELSE agg.points_earned END AS points_earned,
      CASE WHEN pfs.profile_id IS NOT NULL
           THEN pfs.position
           ELSE COALESCE(agg.playoff_final_position, agg.position) END AS position
  ) m
  WHERE e.group_id = p_group_id
    AND e.standings_contribution IN ('season', 'both')
    AND e.majors_status IN ('live', 'completed', 'official')
    AND agg.net_score IS NOT NULL
  GROUP BY agg.profile_id;
END;
$$;

-- ── 4. Recompute every group's standings ──────────────────────
DO $$
DECLARE g_id uuid;
BEGIN
  FOR g_id IN SELECT id FROM public.major_groups LOOP
    PERFORM public.ciaga_compute_group_standings(g_id);
  END LOOP;
END $$;

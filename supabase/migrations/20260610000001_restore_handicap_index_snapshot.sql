-- Restore handicap_index snapshot step in ciaga_persist_playing_handicaps.
--
-- REGRESSION: Migration 20260609000003 rewrote ciaga_persist_playing_handicaps to add
-- event allowance_pct support but accidentally removed the handicap_index snapshot step
-- that was introduced in 20260218000001_fix_handicap_snapshot_at_round_start.sql.
--
-- round_participants.handicap_index is populated exclusively by this function (called at
-- round start via /api/rounds/start). With the snapshot step removed, handicap_index = NULL
-- for all rounds started after migration 003 deployed, causing:
--   course_handicap_used = COALESCE(round(NULL × slope/113 + …), 0) = 0
--   playing_handicap_used = FLOOR(0 × allowance_pct / 100) = 0
-- All players appeared as scratch on the format scorecard.
--
-- FIX:
--   1. Restore Step 1 (snapshot handicap_index from current_handicaps) from migration 002.
--   2. Keep the two-step course/playing computation from migration 003.
--   3. Guard the allowance_pct branch with IS NOT NULL so a missing tee snapshot falls
--      back to ciaga_resolve_playing_handicap rather than computing 0.
--   4. Backfill: re-run the corrected function for all rounds where handicap_index is still
--      NULL (those started while migration 003 was the live version).

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text    := 'none';
  v_event_allowance_pct  numeric := 100;
BEGIN
  -- Step 1 (RESTORED): snapshot the current HI for all non-guest participants.
  -- Must run first so Steps 2–3 can read a valid handicap_index.
  -- Guests (no profile_id) are skipped and stay at NULL unless manually overridden.
  UPDATE public.round_participants rp
  SET handicap_index = ch.handicap_index
  FROM public.current_handicaps ch
  WHERE rp.round_id = p_round_id
    AND rp.profile_id = ch.profile_id;

  -- Detect event allowance rule for this round.
  SELECT
    COALESCE(e.handicap_rules->>'mode', 'none'),
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
  INTO v_event_handicap_mode, v_event_allowance_pct
  FROM public.event_round_submissions ers
  JOIN public.events e ON e.id = ers.event_id
  WHERE ers.round_id = p_round_id
  LIMIT 1;

  -- Step 2: persist raw 100% WHS course handicap.
  UPDATE public.round_participants rp
  SET course_handicap_used = COALESCE(
    round(
      (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
      + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
    )::integer,
    0
  )
  FROM public.round_tee_snapshots rts
  WHERE rp.round_id = p_round_id
    AND rts.id = rp.tee_snapshot_id;

  -- Step 3: persist competition playing handicap.
  -- Priority: manual override > event allowance > round-level default.
  -- The allowance_pct branch is guarded by IS NOT NULL: if course_handicap_used is
  -- NULL (no tee snapshot for this participant), fall back to ciaga_resolve_playing_handicap
  -- rather than computing FLOOR(COALESCE(NULL, 0) × pct / 100) = 0.
  UPDATE public.round_participants rp
  SET playing_handicap_used = CASE
    WHEN rp.assigned_playing_handicap IS NOT NULL
      THEN rp.assigned_playing_handicap
    WHEN v_event_handicap_mode = 'allowance_pct' AND rp.course_handicap_used IS NOT NULL
      THEN FLOOR(rp.course_handicap_used::numeric * v_event_allowance_pct / 100)::integer
    ELSE public.ciaga_resolve_playing_handicap(p_round_id, rp.id)
  END
  WHERE rp.round_id = p_round_id;
END;
$$;

-- Backfill: re-run for rounds where handicap_index was never snapshotted (NULL on a
-- profiled participant) — these are rounds started while migration 003 was live.
-- Rounds predating migration 003 have handicap_index already set and are skipped.
DO $$
DECLARE v_round_id uuid;
BEGIN
  FOR v_round_id IN
    SELECT DISTINCT rp.round_id
    FROM public.round_participants rp
    WHERE rp.handicap_index IS NULL
      AND rp.profile_id IS NOT NULL
  LOOP
    PERFORM public.ciaga_persist_playing_handicaps(v_round_id);
  END LOOP;
END $$;

-- Recompute all event leaderboards to reflect any corrected playing handicaps.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.events WHERE scoring_model != 'match_result' LOOP
    PERFORM public.ciaga_compute_event_leaderboard(v_id);
  END LOOP;
END $$;

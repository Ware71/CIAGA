-- Fix ciaga_persist_playing_handicaps to use the event's handicap_rules.allowance_pct
-- when the round belongs to a competition event.
--
-- Previously the function called ciaga_resolve_playing_handicap, which reads
-- rounds.default_playing_handicap_value (a round-level setting that defaults to 100%).
-- When an event has allowance_pct = 95 but the round was created at 100%, playing_handicap_used
-- was stored as the full handicap, causing the strokeplay scorecard to disagree with the
-- leaderboard (which was separately patched in 20260609000002 to apply the event allowance).
--
-- The fix splits the single UPDATE into two steps so playing_handicap_used can read the
-- freshly-written course_handicap_used, and gives event allowance precedence over the
-- round-level default (while still respecting assigned_playing_handicap overrides).

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text    := 'none';
  v_event_allowance_pct  numeric := 100;
BEGIN
  -- Check whether this round belongs to an event with an allowance rule.
  -- LIMIT 1: a round maps to exactly one event, but event_round_submissions
  -- has one row per player so we just need any row to get the event settings.
  SELECT
    COALESCE(e.handicap_rules->>'mode', 'none'),
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
  INTO v_event_handicap_mode, v_event_allowance_pct
  FROM public.event_round_submissions ers
  JOIN public.events e ON e.id = ers.event_id
  WHERE ers.round_id = p_round_id
  LIMIT 1;

  -- Step 1: persist the raw 100% WHS course handicap.
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

  -- Step 2: persist the competition playing handicap.
  -- Priority: manual override > event allowance > round-level default.
  -- Reads the course_handicap_used written in Step 1.
  UPDATE public.round_participants rp
  SET playing_handicap_used = CASE
    WHEN rp.assigned_playing_handicap IS NOT NULL
      THEN rp.assigned_playing_handicap
    WHEN v_event_handicap_mode = 'allowance_pct'
      THEN FLOOR(COALESCE(rp.course_handicap_used, 0)::numeric * v_event_allowance_pct / 100)::integer
    ELSE public.ciaga_resolve_playing_handicap(p_round_id, rp.id)
  END
  WHERE rp.round_id = p_round_id;
END;
$$;

-- Backfill: correct playing_handicap_used for all existing event rounds that
-- used a 100% round allowance but belong to an event with allowance_pct mode.
-- Skips rows with a manual assigned_playing_handicap override.
UPDATE public.round_participants rp
SET playing_handicap_used =
  FLOOR(
    COALESCE(rp.course_handicap_used, 0)::numeric
    * (e.handicap_rules->>'allowance_pct')::numeric
    / 100
  )::integer
FROM public.event_round_submissions ers
JOIN public.events e ON e.id = ers.event_id
WHERE ers.round_id = rp.round_id
  AND e.handicap_rules->>'mode' = 'allowance_pct'
  AND rp.course_handicap_used IS NOT NULL
  AND rp.assigned_playing_handicap IS NULL;

-- Recompute all event leaderboards so scores reflect the corrected playing handicaps.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.events WHERE scoring_model != 'match_result' LOOP
    PERFORM public.ciaga_compute_event_leaderboard(v_id);
  END LOOP;
END $$;

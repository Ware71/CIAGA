-- Fix ciaga_persist_playing_handicaps to detect event mode for live (not-yet-submitted) rounds.
--
-- PROBLEM: The function detects the event's handicap_rules by querying event_round_submissions.
-- However, a round that is currently live (in-progress) has no entry in event_round_submissions
-- yet — that table is only populated when scores are submitted/accepted. So at round start
-- (and during any subsequent call), v_event_handicap_mode remains 'none' for live event rounds,
-- causing them to use ciaga_resolve_playing_handicap (round-level default, typically 100%)
-- instead of the event's allowance_pct formula.
--
-- The migration 006 backfill also only targeted event_round_submissions, so live rounds
-- that had been started between migration 005 and 006 were never corrected.
--
-- FIX:
--   1. Add a fallback lookup via rounds → event_tee_times → events so that a live round
--      whose tee time belongs to an allowance_pct event is detected correctly.
--   2. Backfill: re-run ciaga_persist_playing_handicaps for all currently-live rounds in
--      allowance_pct events so their playing_handicap_used is corrected to ROUND values.

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text    := 'none';
  v_event_allowance_pct  numeric := 100;
BEGIN
  -- Step 1: Snapshot the current HI for all non-guest participants.
  UPDATE public.round_participants rp
  SET handicap_index = ch.handicap_index
  FROM public.current_handicaps ch
  WHERE rp.round_id = p_round_id
    AND rp.profile_id = ch.profile_id;

  -- Detect event allowance rule: check event_round_submissions first (submitted rounds),
  -- then fall back to event_tee_times (live rounds not yet submitted).
  SELECT
    COALESCE(e.handicap_rules->>'mode', 'none'),
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
  INTO v_event_handicap_mode, v_event_allowance_pct
  FROM public.event_round_submissions ers
  JOIN public.events e ON e.id = ers.event_id
  WHERE ers.round_id = p_round_id
  LIMIT 1;

  IF v_event_handicap_mode = 'none' THEN
    SELECT
      COALESCE(e.handicap_rules->>'mode', 'none'),
      COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
    INTO v_event_handicap_mode, v_event_allowance_pct
    FROM public.rounds r
    JOIN public.event_tee_times ctt ON ctt.id = r.event_tee_time_id
    JOIN public.events e ON e.id = ctt.event_id
    WHERE r.id = p_round_id
    LIMIT 1;
  END IF;

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
  -- Priority: manual override > event allowance (ROUND, WHS standard) > round-level default.
  UPDATE public.round_participants rp
  SET playing_handicap_used = CASE
    WHEN rp.assigned_playing_handicap IS NOT NULL
      THEN rp.assigned_playing_handicap
    WHEN v_event_handicap_mode = 'allowance_pct' AND rp.course_handicap_used IS NOT NULL
      THEN ROUND(rp.course_handicap_used::numeric * v_event_allowance_pct / 100)::integer
    ELSE public.ciaga_resolve_playing_handicap(p_round_id, rp.id)
  END
  WHERE rp.round_id = p_round_id;
END;
$$;

-- Backfill: re-run for all currently-live rounds in allowance_pct events.
-- These were missed by migration 006's backfill (which only looked in event_round_submissions).
DO $$
DECLARE v_round_id uuid;
BEGIN
  FOR v_round_id IN
    SELECT DISTINCT r.id
    FROM public.rounds r
    JOIN public.event_tee_times ctt ON ctt.id = r.event_tee_time_id
    JOIN public.events e ON e.id = ctt.event_id
    WHERE COALESCE(e.handicap_rules->>'mode', 'none') = 'allowance_pct'
      AND r.status = 'live'
  LOOP
    PERFORM public.ciaga_persist_playing_handicaps(v_round_id);
  END LOOP;
END $$;

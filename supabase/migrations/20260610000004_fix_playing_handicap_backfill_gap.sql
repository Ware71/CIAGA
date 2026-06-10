-- Fix playing_handicap_used for rounds that slipped through prior backfills.
--
-- PROBLEM: Migrations 002 and 003 backfilled playing_handicap_used via
-- ciaga_persist_playing_handicaps, but that function re-snapshots the current
-- handicap_index (Step 1), which corrupts course_handicap_used for historical rounds
-- if the player's HI has changed. It also missed rounds that were 'finished'
-- (scoring complete) but not yet in event_round_submissions when migration 002 ran
-- AND not 'live' when migration 003 ran — the gap between those two statuses.
--
-- FIX: Direct UPDATE of playing_handicap_used using the already-stored
-- course_handicap_used. No HI re-snapshot, no CH recomputation. Covers both
-- submitted rounds (via event_round_submissions) and tee-time-linked rounds
-- (via rounds → event_tee_times → events).

UPDATE public.round_participants rp
SET playing_handicap_used =
  ROUND(rp.course_handicap_used::numeric * event_rules.allowance_pct / 100)::integer
FROM (
  -- Path A: submitted rounds
  SELECT ers.round_id,
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100) AS allowance_pct
  FROM public.event_round_submissions ers
  JOIN public.events e ON e.id = ers.event_id
  WHERE COALESCE(e.handicap_rules->>'mode', 'none') = 'allowance_pct'

  UNION

  -- Path B: tee-time-linked rounds (live / finished but not yet submitted)
  SELECT r.id AS round_id,
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100) AS allowance_pct
  FROM public.rounds r
  JOIN public.event_tee_times ctt ON ctt.id = r.event_tee_time_id
  JOIN public.events e ON e.id = ctt.event_id
  WHERE COALESCE(e.handicap_rules->>'mode', 'none') = 'allowance_pct'
) event_rules
WHERE rp.round_id = event_rules.round_id
  AND rp.assigned_playing_handicap IS NULL
  AND rp.course_handicap_used IS NOT NULL;

-- Recompute all event leaderboards so net_score and positions reflect corrected values.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.events WHERE scoring_model != 'match_result' LOOP
    PERFORM public.ciaga_compute_event_leaderboard(v_id);
  END LOOP;
END $$;

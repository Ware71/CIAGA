-- ============================================================
-- Make the handicap snapshot lock the event itself.
--
-- Found while playing The International 2026 through the browser: on the
-- event's FIRST round, participants did not pick up the event lock —
-- Jack Wilson's round 1 used 6.1 where the lock held 7.6, and a player with no
-- prior index got NULL. Rounds started afterwards honoured the lock exactly.
--
-- Cause: the lock is written by ciaga_lock_event_handicaps from the start
-- route, immediately before ciaga_persist_playing_handicaps. Those are two
-- separate calls, and the scorecard can fire /api/rounds/start concurrently
-- (entering the first score starts the round), so one request's persist can run
-- against a lock the other request has not yet committed.
--
-- Rather than tighten the ordering in the route — which only narrows the race —
-- persist now performs the lock itself, in the same transaction, before reading
-- it. The route's call becomes belt-and-braces.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text;
  v_event_allowance_pct  numeric;
  v_event_id             uuid;
BEGIN
  -- Which event, if any, this round belongs to.
  SELECT ett.event_id INTO v_event_id
  FROM public.event_tee_times ett
  WHERE ett.round_id = p_round_id
  LIMIT 1;

  -- Lock the field's handicaps before reading the lock. Idempotent: fills only
  -- NULL locks and stamps handicap_locked_at once. Doing it here means the
  -- event's very first round cannot race the lock.
  IF v_event_id IS NOT NULL THEN
    PERFORM public.ciaga_lock_event_handicaps(v_event_id);
  END IF;

  -- Step 1: resolve the Handicap Index this round plays off.
  -- Priority: per-round admin override > event lock > existing snapshot >
  -- the player's current index.
  UPDATE public.round_participants rp
  SET handicap_index = COALESCE(
    rp.assigned_handicap_index,
    (SELECT ee.locked_handicap_index
       FROM public.event_entries ee
      WHERE ee.event_id = v_event_id
        AND ee.profile_id = rp.profile_id),
    rp.handicap_index,
    (SELECT ch.handicap_index
     FROM public.current_handicaps ch
     WHERE ch.profile_id = rp.profile_id)
  )
  WHERE rp.round_id = p_round_id
    AND (rp.profile_id IS NOT NULL OR rp.assigned_handicap_index IS NOT NULL);

  -- Detect event allowance rule for this round: submissions first, then
  -- rounds → event_tee_times → events (a live round has no submission yet).
  -- NB: SELECT INTO with no rows NULLs the targets — normalise after each.
  SELECT
    COALESCE(e.handicap_rules->>'mode', 'none'),
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
  INTO v_event_handicap_mode, v_event_allowance_pct
  FROM public.event_round_submissions ers
  JOIN public.events e ON e.id = ers.event_id
  WHERE ers.round_id = p_round_id
  LIMIT 1;

  v_event_handicap_mode := COALESCE(v_event_handicap_mode, 'none');

  IF v_event_handicap_mode = 'none' AND v_event_id IS NOT NULL THEN
    SELECT
      COALESCE(e.handicap_rules->>'mode', 'none'),
      COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
    INTO v_event_handicap_mode, v_event_allowance_pct
    FROM public.events e
    WHERE e.id = v_event_id;

    v_event_handicap_mode := COALESCE(v_event_handicap_mode, 'none');
  END IF;

  v_event_allowance_pct := COALESCE(v_event_allowance_pct, 100);

  -- Step 2: persist raw 100% WHS course handicap.
  UPDATE public.round_participants rp
  SET course_handicap_used = public.ciaga_course_handicap(
    rp.handicap_index, rts.slope, rts.rating, rts.par_total
  )
  FROM public.round_tee_snapshots rts
  WHERE rp.round_id = p_round_id
    AND rts.id = rp.tee_snapshot_id;

  -- Step 3: persist competition playing handicap.
  -- Priority: manual override > event allowance > round-level default.
  -- The allowance applies to the ROUNDED course handicap, per WHS.
  UPDATE public.round_participants rp
  SET playing_handicap_used = CASE
    WHEN rp.assigned_playing_handicap IS NOT NULL
      THEN rp.assigned_playing_handicap
    WHEN v_event_handicap_mode = 'allowance_pct' AND rp.course_handicap_used IS NOT NULL
      THEN round(rp.course_handicap_used::numeric * v_event_allowance_pct / 100)::integer
    ELSE public.ciaga_resolve_playing_handicap(p_round_id, rp.id)
  END
  WHERE rp.round_id = p_round_id;
END;
$$;

COMMENT ON FUNCTION public.ciaga_persist_playing_handicaps(uuid) IS
  'Locks in handicap_index, course_handicap_used and playing_handicap_used at
   round start. Calls ciaga_lock_event_handicaps itself so the event''s first
   round cannot race the lock. Index precedence: per-round override, event lock,
   existing snapshot, current index.';

-- ============================================================================
-- Backdated playing handicaps + override-respecting live snapshot.
--
-- PROBLEM: the season import pre-sets round_participants.handicap_index to the
-- spreadsheet handicap (or the as-of-event-date HI for blanks), but
-- ciaga_persist_playing_handicaps Step 1 unconditionally re-snapshots from the
-- current_handicaps view — the player's HI *today*. course_handicap_used and
-- playing_handicap_used (frozen, replay-protected) are then derived from
-- today's HI, so every imported event is scored off current handicaps.
--
-- FIX (two functions):
--   1. ciaga_persist_playing_handicaps_backdated — used by the season import.
--      Identical to the live function but its snapshot step has NO path to
--      current_handicaps: a backdated round must reflect the handicap at that
--      moment in time, or nothing at all.
--   2. ciaga_persist_playing_handicaps (live) — snapshot priority becomes
--      assigned_handicap_index > existing handicap_index > current_handicaps:
--        - pre-round HI overrides (set-handicap-index API) now actually drive
--          CH/PH on event-allowance rounds instead of being clobbered;
--        - snapshot-once: re-running persist on an old round can no longer
--          re-stamp today's HI (the corruption fixed in 20260610000004);
--        - normal live rounds are unchanged (handicap_index is NULL at round
--          start, so the current_handicaps snapshot still applies).
--
-- WHS integrity: untouched. The handicap replay owns handicap_index,
-- handicap_round_results and handicap_index_history; it never reads
-- assigned_handicap_index, and it never writes course/playing_handicap_used.
-- ============================================================================

-- ─── 1. Backdated variant (season import / backfills) ───────────────────────

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps_backdated(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text    := 'none';
  v_event_allowance_pct  numeric := 100;
BEGIN
  -- Step 1: honour the assigned HI override; otherwise keep whatever snapshot
  -- the caller pre-set. NEVER read current_handicaps — this round is backdated.
  UPDATE public.round_participants rp
  SET handicap_index = COALESCE(rp.assigned_handicap_index, rp.handicap_index)
  WHERE rp.round_id = p_round_id
    AND rp.profile_id IS NOT NULL;

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

COMMENT ON FUNCTION public.ciaga_persist_playing_handicaps_backdated(uuid) IS
  'Persist CH/PH for a backdated (imported) round. Uses assigned_handicap_index
   or the pre-set handicap_index snapshot; never reads current_handicaps, so a
   historical round can never pick up the player''s HI as of today.';

-- ─── 2. Live function: snapshot-once with override priority ─────────────────

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text    := 'none';
  v_event_allowance_pct  numeric := 100;
BEGIN
  -- Step 1: snapshot HI for all non-guest participants.
  -- Priority: assigned HI override > existing snapshot > current HI.
  -- Guests (no profile_id) are skipped and stay at NULL unless manually overridden.
  UPDATE public.round_participants rp
  SET handicap_index = COALESCE(
    rp.assigned_handicap_index,
    rp.handicap_index,
    (SELECT ch.handicap_index
     FROM public.current_handicaps ch
     WHERE ch.profile_id = rp.profile_id)
  )
  WHERE rp.round_id = p_round_id
    AND rp.profile_id IS NOT NULL;

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

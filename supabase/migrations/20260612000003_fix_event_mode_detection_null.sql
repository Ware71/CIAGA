-- ============================================================================
-- Fix dead event-detection in ciaga_persist_playing_handicaps(+_backdated).
--
-- BUG: PL/pgSQL `SELECT ... INTO` with ZERO rows sets the target variables to
-- NULL — it does not preserve their initial values. The detection pattern
--
--   v_event_handicap_mode text := 'none';
--   SELECT ... INTO v_event_handicap_mode ... FROM event_round_submissions ...;
--   IF v_event_handicap_mode = 'none' THEN  -- tee-time fallback
--
-- therefore NEVER runs the fallback when a round has no submissions yet
-- (NULL = 'none' is not true), and Step 3's allowance branch is skipped too,
-- falling into ciaga_resolve_playing_handicap — whose override branch returns
-- ROUND(assigned_handicap_index) AS the playing handicap. This is why imported
-- rounds stored the sheet handicap INDEX directly as the PH.
--
-- The bug is inherited from 20260610000003 (its tee-time fallback was dead on
-- arrival — the reason 20260610000004 found rounds that "slipped through"),
-- and also affects live event rounds at round start (no submissions yet).
--
-- FIX: COALESCE the mode back to 'none' after each detection query, and
-- backfill playing_handicap_used for affected event rounds.
-- ============================================================================

-- ─── 1a. Live persist ────────────────────────────────────────────────────────

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

  -- Detect event allowance rule: event_round_submissions first, then
  -- rounds → event_tee_times → events (rounds not yet submitted).
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

    v_event_handicap_mode := COALESCE(v_event_handicap_mode, 'none');
  END IF;

  v_event_allowance_pct := COALESCE(v_event_allowance_pct, 100);

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

-- ─── 1b. Backdated persist: identical, but no current_handicaps path ─────────

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps_backdated(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text    := 'none';
  v_event_allowance_pct  numeric := 100;
BEGIN
  -- Step 1: honour the assigned HI override; otherwise keep the caller's
  -- pre-set snapshot. NEVER read current_handicaps — this round is backdated.
  UPDATE public.round_participants rp
  SET handicap_index = COALESCE(rp.assigned_handicap_index, rp.handicap_index)
  WHERE rp.round_id = p_round_id
    AND rp.profile_id IS NOT NULL;

  -- Detect event allowance rule (same two-path detection as the live function).
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

    v_event_handicap_mode := COALESCE(v_event_handicap_mode, 'none');
  END IF;

  v_event_allowance_pct := COALESCE(v_event_allowance_pct, 100);

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

-- ─── 2. Backfill: repair PH for event rounds hit by the dead fallback ────────
-- Same shape as 20260610000004 (which this bug made necessary the first time):
-- rounds linked to allowance_pct events via submissions OR tee times, skipping
-- manual assigned_playing_handicap overrides. Leaderboards need no recompute —
-- for allowance events they derive the handicap from course_handicap_used.

UPDATE public.round_participants rp
SET playing_handicap_used =
  ROUND(rp.course_handicap_used::numeric * event_rules.allowance_pct / 100)::integer
FROM (
  SELECT ers.round_id,
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100) AS allowance_pct
  FROM public.event_round_submissions ers
  JOIN public.events e ON e.id = ers.event_id
  WHERE COALESCE(e.handicap_rules->>'mode', 'none') = 'allowance_pct'

  UNION

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

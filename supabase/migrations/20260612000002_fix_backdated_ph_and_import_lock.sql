-- ============================================================================
-- Fix 1: ciaga_persist_playing_handicaps(+_backdated) — restore the latest
--        pre-20260612 behaviour that 20260612000001 accidentally regressed.
--
-- 20260612000001 copied the function body from 20260610000001, but the latest
-- definition was 20260610000003, which had:
--   - ROUND (not FLOOR) for the allowance step (standardised in 20260610000002,
--     matching the leaderboard), and
--   - tee-time fallback event detection (rounds → event_tee_times → events)
--     for rounds with no event_round_submissions row yet.
--
-- The missing fallback broke the season import: the backdated persist runs
-- before submissions exist, so the event mode resolved to 'none', Step 3 fell
-- into ciaga_resolve_playing_handicap, and its override branch stored the
-- sheet handicap INDEX directly as the Playing Handicap. With detection fixed,
-- the index goes through the proper chain: CH = ROUND(HI × slope/113 + CR − par),
-- PH = ROUND(CH × allowance).
--
-- Step 1 semantics from 20260612000001 are kept:
--   live:      COALESCE(assigned_handicap_index, handicap_index, current HI)
--   backdated: COALESCE(assigned_handicap_index, handicap_index)  — a backdated
--              round must never read current_handicaps.
--
-- Fix 2: season_import_locks — one import per group at a time. A "failed to
--        fetch" in the browser leaves the serverless import running; a retry
--        then executes concurrently and bypasses the skip-on-reimport check
--        (which snapshots existing round names once per event), duplicating
--        rounds. The import route takes this lock per request.
-- ============================================================================

-- ─── 1a. Live persist: snapshot-once + override priority, ROUND, 2-path detection

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

  -- Detect event allowance rule: event_round_submissions first (submitted
  -- rounds), then rounds → event_tee_times → events (live / not-yet-submitted).
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

  -- Detect event allowance rule (same two-path detection as the live function;
  -- imported rounds are linked via event_tee_times before persist runs).
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

COMMENT ON FUNCTION public.ciaga_persist_playing_handicaps_backdated(uuid) IS
  'Persist CH/PH for a backdated (imported) round. Uses assigned_handicap_index
   or the pre-set handicap_index snapshot as the INDEX (CH = ROUND(HI × slope/113
   + CR − par), PH = ROUND(CH × allowance)); never reads current_handicaps.';

-- ─── 2. Per-group import lock ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.season_import_locks (
  group_id  uuid PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now()
);

-- Service-role only: RLS enabled with no policies.
ALTER TABLE public.season_import_locks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.season_import_locks IS
  'One season-import request per group at a time. Acquired/released by
   /api/admin/season-import/import; rows older than ~6 min are treated as
   stale (serverless maxDuration is 300s).';

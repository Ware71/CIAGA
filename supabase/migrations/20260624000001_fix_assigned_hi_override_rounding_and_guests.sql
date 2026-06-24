-- ============================================================================
-- Fix assigned_handicap_index override handling and allowance rounding.
--
-- PROBLEMS fixed:
--
-- 1. ciaga_resolve_playing_handicap still treated assigned_handicap_index as a
--    direct playing-handicap override (ROUND(HI) = PH). After migration
--    20260612000001, assigned_handicap_index became an HI override: Step 1 of
--    ciaga_persist_playing_handicaps already stamped it into handicap_index
--    before this resolver is called. The CASE block is therefore redundant and
--    returns the wrong value for allowance_pct rounds (raw HI ≠ PH).
--
-- 2. The event-allowance branch in Step 3 of both persist functions used FLOOR,
--    while the standalone path (ciaga_resolve_playing_handicap) uses round().
--    WHS spec says PH should be rounded to the nearest whole number.
--
-- 3. Step 1 of both persist functions filtered AND rp.profile_id IS NOT NULL,
--    silently ignoring guest participants whose assigned_handicap_index was set
--    by the round owner. Their handicap_index stayed NULL → course_handicap_used
--    and playing_handicap_used were both computed as 0.
-- ============================================================================

-- ─── 1. Fix ciaga_resolve_playing_handicap ──────────────────────────────────
-- Remove the stale assigned_handicap_index branch. By the time this function
-- is called (Step 3 of ciaga_persist_playing_handicaps), handicap_index is
-- already set by Step 1 to reflect any override, so we just need the
-- mode-based calculation using handicap_index.

CREATE OR REPLACE FUNCTION public.ciaga_resolve_playing_handicap(
  p_round_id     uuid,
  p_participant_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    -- Legacy direct PH override (assigned_playing_handicap) only.
    -- assigned_handicap_index is no longer handled here; it is applied in
    -- ciaga_persist_playing_handicaps Step 1 and flows through handicap_index.
    rp.assigned_playing_handicap,

    -- Round default calculation using handicap_index (already reflects any
    -- assigned_handicap_index override stamped by Step 1).
    CASE r.default_playing_handicap_mode
      WHEN 'fixed' THEN
        r.default_playing_handicap_value::integer

      WHEN 'allowance_pct' THEN
        COALESCE(
          round(
            (
              (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
              + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
            ) * r.default_playing_handicap_value / 100.0
          )::integer,
          0
        )

      WHEN 'compare_against_lowest' THEN
        -- Best player plays off scratch; everyone else gets the difference.
        -- This branch is handled by the UI/caller; fall back to 0 here.
        0

      ELSE 0  -- 'none' or NULL
    END,

    0
  )
  FROM public.round_participants rp
  JOIN public.rounds r ON r.id = rp.round_id
  LEFT JOIN public.round_tee_snapshots rts ON rts.id = rp.tee_snapshot_id
  WHERE rp.round_id = p_round_id
    AND rp.id = p_participant_id;
$$;

COMMENT ON FUNCTION public.ciaga_resolve_playing_handicap(uuid, uuid) IS
  'Resolve playing handicap for a participant using the round default mode.
   Assumes handicap_index has already been stamped by ciaga_persist_playing_handicaps
   Step 1 (including any assigned_handicap_index override).';

-- ─── 2. Fix ciaga_persist_playing_handicaps (live) ──────────────────────────
-- Changes:
--   Step 1: include guests who have assigned_handicap_index set.
--   Step 3: FLOOR → round() for WHS-compliant allowance rounding.

CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text    := 'none';
  v_event_allowance_pct  numeric := 100;
BEGIN
  -- Step 1: snapshot HI for all participants.
  -- Priority: assigned HI override > existing snapshot > current HI.
  -- Members (profile_id IS NOT NULL) always included.
  -- Guests (no profile_id) included only when they have an explicit override,
  -- so their course/playing handicap can be derived from it.
  UPDATE public.round_participants rp
  SET handicap_index = COALESCE(
    rp.assigned_handicap_index,
    rp.handicap_index,
    (SELECT ch.handicap_index
     FROM public.current_handicaps ch
     WHERE ch.profile_id = rp.profile_id)
  )
  WHERE rp.round_id = p_round_id
    AND (rp.profile_id IS NOT NULL OR rp.assigned_handicap_index IS NOT NULL);

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
  -- Uses round() (nearest whole number) per WHS spec.
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

-- ─── 3. Fix ciaga_persist_playing_handicaps_backdated ───────────────────────
-- Same two changes as the live function: guest Step 1 inclusion + round().

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
  -- Guests with an explicit override are now included (same as live function).
  UPDATE public.round_participants rp
  SET handicap_index = COALESCE(rp.assigned_handicap_index, rp.handicap_index)
  WHERE rp.round_id = p_round_id
    AND (rp.profile_id IS NOT NULL OR rp.assigned_handicap_index IS NOT NULL);

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
  -- Uses round() (nearest whole number) per WHS spec.
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

COMMENT ON FUNCTION public.ciaga_persist_playing_handicaps_backdated(uuid) IS
  'Persist CH/PH for a backdated (imported) round. Uses assigned_handicap_index
   or the pre-set handicap_index snapshot; never reads current_handicaps, so a
   historical round can never pick up the player''s HI as of today.
   Guests with an explicit assigned_handicap_index are included in Step 1.';

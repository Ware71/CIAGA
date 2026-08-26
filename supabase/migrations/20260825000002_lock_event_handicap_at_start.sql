-- ============================================================
-- Multi-round: fix each player's Handicap Index for the whole event.
--
-- Every round snapshots the player's THEN-CURRENT index onto
-- round_participants.handicap_index, read from current_handicaps — which has no
-- date cut-off. Finishing a round triggers recalc_handicap_profile, which
-- writes today's index. So round 2 of a 36-hole championship was played off an
-- index that had already absorbed round 1.
--
-- A committee fixes the handicap for the duration of the competition. This
-- captures each entrant's index when the event starts and uses it for every
-- round of that event.
--
-- Deliberate consequence: a two-day event now uses the day-1 index for both
-- rounds rather than letting WHS's overnight revision move it.
-- ============================================================

-- ── 1. Storage ────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS handicap_locked_at timestamptz;

COMMENT ON COLUMN public.events.handicap_locked_at IS
  'Set the first time a round of this event starts. Once set, every round of
   the event plays off event_entries.locked_handicap_index.';

ALTER TABLE public.event_entries
  ADD COLUMN IF NOT EXISTS locked_handicap_index numeric;

COMMENT ON COLUMN public.event_entries.locked_handicap_index IS
  'The entrant''s Handicap Index as at event start. Overridden by a per-round
   round_participants.assigned_handicap_index, which stays the manual escape
   hatch for an admin.';

-- ── 2. Lock the field ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_lock_event_handicaps(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Fill any entrant that has no locked index yet. Runs on every round start,
  -- so a player who enters between rounds is locked at that point rather than
  -- being left to drift. Never overwrites an existing lock.
  UPDATE public.event_entries ee
  SET locked_handicap_index = COALESCE(
    ee.assigned_handicap_index,
    (SELECT ch.handicap_index FROM public.current_handicaps ch
      WHERE ch.profile_id = ee.profile_id)
  )
  WHERE ee.event_id = p_event_id
    AND ee.locked_handicap_index IS NULL;

  -- Stamp the event once, so it is visible that the field is locked.
  UPDATE public.events
  SET handicap_locked_at = now()
  WHERE id = p_event_id
    AND handicap_locked_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.ciaga_lock_event_handicaps(uuid) IS
  'Captures each entrant''s Handicap Index for the duration of an event.
   Idempotent: only fills NULL locks and only stamps handicap_locked_at once.';

GRANT EXECUTE ON FUNCTION public.ciaga_lock_event_handicaps(uuid) TO service_role;

-- ── 3. Teach the handicap snapshot about the lock ─────────────
-- Only Step 1's COALESCE changes; the rest is carried over from
-- 20260624000001. CREATE OR REPLACE (not DROP) so EXECUTE grants survive.
CREATE OR REPLACE FUNCTION public.ciaga_persist_playing_handicaps(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_handicap_mode  text;
  v_event_allowance_pct  numeric;
BEGIN
  -- Step 1: resolve the Handicap Index this round plays off.
  -- Priority: per-round admin override > event lock > existing snapshot >
  -- the player's current index.
  UPDATE public.round_participants rp
  SET handicap_index = COALESCE(
    rp.assigned_handicap_index,
    (SELECT ee.locked_handicap_index
       FROM public.event_tee_times ett
       JOIN public.event_entries ee
         ON ee.event_id = ett.event_id
        AND ee.profile_id = rp.profile_id
      WHERE ett.round_id = p_round_id
      LIMIT 1),
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

  IF v_event_handicap_mode = 'none' THEN
    SELECT
      COALESCE(e.handicap_rules->>'mode', 'none'),
      COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
    INTO v_event_handicap_mode, v_event_allowance_pct
    FROM public.rounds r
    JOIN public.event_tee_times ett ON ett.id = r.event_tee_time_id
    JOIN public.events e ON e.id = ett.event_id
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

COMMENT ON FUNCTION public.ciaga_persist_playing_handicaps(uuid) IS
  'Locks in handicap_index, course_handicap_used and playing_handicap_used at
   round start. The index comes from the per-round override, then the event
   lock (event_entries.locked_handicap_index), then any existing snapshot, then
   current_handicaps. Restores the event-mode fallback that 20260624000001
   dropped.';

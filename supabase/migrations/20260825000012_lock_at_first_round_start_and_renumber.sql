-- ============================================================
-- Two fixes found by playing The International 2026 through.
--
-- 1. The handicap lock captured the ENTRY-time index, not the index as at the
--    first round's start.
--
--    ciaga_lock_event_handicaps read
--      COALESCE(ee.assigned_handicap_index, current_handicaps)
--    and event_entries.assigned_handicap_index is NOT NULL — it is stamped when
--    the player enters. So it always won and current_handicaps was never
--    reached. Jack Wilson locked at 7.6, his index when he entered, while his
--    actual index at event start was 6.1.
--
--    The lock is meant to freeze the field as it stands when play begins, so it
--    now reads current_handicaps first and falls back to the entry value only
--    for a player who has no index at all.
--
-- 2. event_rounds.round_number drifted off 1..N.
--
--    The International 2026 numbered its two rounds 5 and 6: earlier rounds
--    were deleted and the survivors were never shifted down, because new rounds
--    were numbered max(round_number) + 1 and deletes renumbered nothing. That
--    is a data bug, not a display one — round_number is what cut_config's
--    after_round matches on, so a cut configured as "after round 1" would never
--    fire on an event whose first round is numbered 5.
-- ============================================================

-- ── 1. Lock the index as at first-round start ─────────────────
CREATE OR REPLACE FUNCTION public.ciaga_lock_event_handicaps(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- The player's index AS IT STANDS NOW — this runs when the first round
  -- starts. assigned_handicap_index is the entry-time snapshot and is only a
  -- fallback for someone with no index yet (a first-timer).
  UPDATE public.event_entries ee
  SET locked_handicap_index = COALESCE(
    (SELECT ch.handicap_index FROM public.current_handicaps ch
      WHERE ch.profile_id = ee.profile_id),
    ee.assigned_handicap_index
  )
  WHERE ee.event_id = p_event_id
    AND ee.locked_handicap_index IS NULL;

  UPDATE public.events
  SET handicap_locked_at = now()
  WHERE id = p_event_id
    AND handicap_locked_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.ciaga_lock_event_handicaps(uuid) IS
  'Freezes each entrant''s Handicap Index as at the START OF THE FIRST ROUND,
   read from current_handicaps. Falls back to the entry-time
   assigned_handicap_index only for a player with no index. Idempotent: fills
   only NULL locks and stamps handicap_locked_at once.';

-- ── 2. Keep round_number contiguous ───────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_renumber_event_rounds(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- UNIQUE(event_id, round_number) means we cannot shuffle in place, so park
  -- the rows on negative numbers first. Order is preserved by the existing
  -- round_number, so relative sequence survives.
  WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY round_number, created_at) AS rn
    FROM public.event_rounds
    WHERE event_id = p_event_id
  )
  UPDATE public.event_rounds er
  SET round_number = -ordered.rn
  FROM ordered
  WHERE er.id = ordered.id;

  UPDATE public.event_rounds
  SET round_number = -round_number
  WHERE event_id = p_event_id
    AND round_number < 0;
END;
$$;

COMMENT ON FUNCTION public.ciaga_renumber_event_rounds(uuid) IS
  'Renumbers an event''s rounds to 1..N in their existing order. Called after a
   round is deleted so the survivors shift down — cut_config.after_round matches
   on round_number, so gaps are a correctness problem, not cosmetics.';

GRANT EXECUTE ON FUNCTION public.ciaga_renumber_event_rounds(uuid) TO service_role;

-- ── 3. Repair events that already drifted ─────────────────────
DO $$
DECLARE
  r        record;
  v_fixed  integer := 0;
BEGIN
  FOR r IN
    SELECT event_id
    FROM public.event_rounds
    GROUP BY event_id
    -- Not 1..N: either the max exceeds the count, or the min is not 1.
    HAVING MAX(round_number) <> COUNT(*) OR MIN(round_number) <> 1
  LOOP
    PERFORM public.ciaga_renumber_event_rounds(r.event_id);
    v_fixed := v_fixed + 1;

    -- A cut pinned to a now-shifted number would silently stop matching.
    -- There are no cut_configs in the wild yet, but be explicit about it.
    IF EXISTS (SELECT 1 FROM public.events e
                WHERE e.id = r.event_id AND e.cut_config IS NOT NULL) THEN
      RAISE WARNING
        'event % had a cut_config and non-contiguous rounds; check cut_config.after_round still points at the intended round',
        r.event_id;
    END IF;
  END LOOP;

  RAISE NOTICE 'renumbered rounds for % event(s)', v_fixed;
END $$;

-- ── 4. Names follow the numbering ─────────────────────────────
-- A round left called "Round 1" while numbered 5 is exactly how this went
-- unnoticed. Only touch the default-style names; a round the organiser has
-- named ("Sunday Singles") is left alone.
UPDATE public.event_rounds er
SET name = 'Round ' || er.round_number
WHERE er.name ~ '^Round [0-9]+$'
  AND er.name <> 'Round ' || er.round_number;

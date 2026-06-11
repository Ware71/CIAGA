-- ============================================================================
-- Migration: add ciaga_refresh_handicaps_step(p_from_date, p_after_ts,
--                                             p_after_id, p_max_rounds)
--
-- Cursor-batched variant of ciaga_refresh_handicaps_from. A full replay from
-- an early cutoff (multi-season import) processes hundreds of rounds and
-- rebuilds each player's entire HI history per round — far beyond the API
-- statement timeout when run as one statement. This function processes up to
-- p_max_rounds rounds per call and returns a cursor so the caller (the season
-- import UI) can loop until done.
--
-- Semantics per batch are identical to ciaga_refresh_handicaps_from:
--   - first call (null cursor) performs the partial wipe from p_from_date
--   - rounds are replayed in the same chronological order
--   - each batch only appends results for its own rounds; recalc reads
--     handicap_round_results, which is complete for everything before the
--     cursor, so chronological batching is equivalent to one big replay
--
-- INVARIANT (same as ciaga_refresh_handicaps_from):
--   ONLY round_participants.handicap_index is written. NEVER touches:
--     playing_handicap_used, course_handicap_used,
--     assigned_playing_handicap, assigned_handicap_index
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ciaga_refresh_handicaps_step(
  p_from_date  date,
  p_after_ts   timestamptz DEFAULT NULL,
  p_after_id   uuid        DEFAULT NULL,
  p_max_rounds integer     DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  r            record;
  p            record;
  v_round_date date;
  v_hi         numeric;
  v_processed  integer := 0;
  v_last_ts    timestamptz := p_after_ts;
  v_last_id    uuid := p_after_id;
  v_remaining  bigint;
BEGIN
  -- -------------------------------------------------------------------------
  -- First call (no cursor): partial wipe, exactly as ciaga_refresh_handicaps_from
  -- -------------------------------------------------------------------------
  IF p_after_ts IS NULL AND p_after_id IS NULL THEN
    DELETE FROM handicap_round_results hrr
    WHERE hrr.round_id IN (
      SELECT id
      FROM rounds
      WHERE status = 'finished'
        AND coalesce(started_at::date, created_at::date) >= p_from_date
    );

    DELETE FROM handicap_index_history
    WHERE as_of_date >= p_from_date;
  END IF;

  -- -------------------------------------------------------------------------
  -- Replay the next p_max_rounds finished rounds after the cursor
  -- -------------------------------------------------------------------------
  FOR r IN
    SELECT
      id,
      coalesce(started_at, created_at)               AS round_ts,
      coalesce(started_at::date, created_at::date)   AS round_date
    FROM rounds
    WHERE status = 'finished'
      AND coalesce(started_at::date, created_at::date) >= p_from_date
      AND (
        p_after_ts IS NULL
        OR (coalesce(started_at, created_at), id) > (p_after_ts, p_after_id)
      )
    ORDER BY coalesce(started_at, created_at), id
    LIMIT p_max_rounds
  LOOP
    v_round_date := r.round_date;

    -- 2a) Snapshot HI onto each participant (HI as-of the round date).
    FOR p IN
      SELECT id, profile_id
      FROM round_participants
      WHERE round_id = r.id
    LOOP
      IF p.profile_id IS NOT NULL THEN
        v_hi := ciaga_true_hi_as_of(p.profile_id, v_round_date);

        IF v_hi IS NOT NULL THEN
          v_hi := least(54.0, v_hi);
        END IF;

        UPDATE round_participants
        SET handicap_index = v_hi
        WHERE id = p.id;
      END IF;
    END LOOP;

    -- 2b) Compute handicap_round_results for every participant in this round.
    FOR p IN
      SELECT id
      FROM round_participants
      WHERE round_id = r.id
    LOOP
      PERFORM upsert_handicap_round_result(p.id);
    END LOOP;

    -- 2c) Rebuild full HI history for every profile in this round.
    FOR p IN
      SELECT DISTINCT profile_id
      FROM round_participants
      WHERE round_id = r.id
        AND profile_id IS NOT NULL
    LOOP
      PERFORM recalc_handicap_profile(p.profile_id);
    END LOOP;

    v_processed := v_processed + 1;
    v_last_ts   := r.round_ts;
    v_last_id   := r.id;
  END LOOP;

  -- Rounds still left after the new cursor (for caller progress display)
  SELECT count(*)
  INTO v_remaining
  FROM rounds
  WHERE status = 'finished'
    AND coalesce(started_at::date, created_at::date) >= p_from_date
    AND (
      v_last_ts IS NULL
      OR (coalesce(started_at, created_at), id) > (v_last_ts, v_last_id)
    );

  RETURN jsonb_build_object(
    'processed', v_processed,
    'last_ts',   v_last_ts,
    'last_id',   v_last_id,
    'remaining', v_remaining
  );
END;
$function$;

COMMENT ON FUNCTION public.ciaga_refresh_handicaps_step(date, timestamptz, uuid, integer) IS
  'Cursor-batched handicap replay. First call (null cursor) wipes derived data
   from p_from_date, then each call replays up to p_max_rounds rounds in
   chronological order and returns {processed, last_ts, last_id, remaining}.
   Loop with the returned cursor until remaining = 0. Batch semantics match
   ciaga_refresh_handicaps_from exactly.

   NEVER modifies these round_participants columns:
     playing_handicap_used, course_handicap_used,
     assigned_playing_handicap, assigned_handicap_index';

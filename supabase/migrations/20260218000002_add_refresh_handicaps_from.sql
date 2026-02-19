-- ============================================================================
-- Migration: add ciaga_refresh_handicaps_from(p_from_date)
--
-- Adds a partial-rebuild variant of ciaga_refresh_handicaps_sequential that
-- can replay the handicap pipeline from a specific date forward, enabling
-- retrospective round entry without a full wipe-and-rebuild.
--
-- INVARIANT (enforced by design):
--   This function ONLY updates round_participants.handicap_index (the WHS HI
--   snapshot used for AGS/SD computation).  It NEVER touches:
--     - round_participants.playing_handicap_used     (format scoring, frozen)
--     - round_participants.course_handicap_used      (format course HC, frozen)
--     - round_participants.assigned_playing_handicap (manual override, frozen)
--     - round_participants.assigned_handicap_index   (manual HI override, frozen)
--   handicap_round_results.course_handicap_used is a derived field and IS
--   recalculated (it comes from compute_handicap_round_result, not from the
--   frozen round_participants column of the same name).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ciaga_refresh_handicaps_from(
  p_from_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  r         record;
  p         record;
  v_round_date date;
  v_hi      numeric;
BEGIN
  -- -------------------------------------------------------------------------
  -- STEP 1: Partial or full wipe of derived tables
  -- -------------------------------------------------------------------------
  -- When p_from_date IS NULL we mirror the existing full-rebuild behaviour:
  -- wipe everything.  When a date is supplied, we only remove rows that will
  -- be recomputed (rounds on or after the cutoff).
  --
  -- PROTECTED columns on round_participants (NEVER written):
  --   playing_handicap_used, course_handicap_used,
  --   assigned_playing_handicap, assigned_handicap_index
  -- -------------------------------------------------------------------------

  IF p_from_date IS NULL THEN
    -- Full rebuild: wipe all derived outputs
    DELETE FROM handicap_round_results;
    DELETE FROM handicap_index_history;
  ELSE
    -- Partial rebuild: remove only the portion that will be recalculated.
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
  -- STEP 2: Replay finished rounds chronologically (from cutoff or all)
  -- -------------------------------------------------------------------------

  FOR r IN
    SELECT
      id,
      coalesce(started_at::date, created_at::date) AS round_date
    FROM rounds
    WHERE status = 'finished'
      AND (
        p_from_date IS NULL
        OR coalesce(started_at::date, created_at::date) >= p_from_date
      )
    ORDER BY coalesce(started_at, created_at), id
  LOOP
    v_round_date := r.round_date;

    -- 2a) Snapshot HI onto each participant (HI as-of the round date).
    --     Uses round_date (not day-before) so that multiple rounds on the
    --     same day each see the HI built by earlier rounds in the replay.
    --     No circular dependency: step 2c hasn't run for the *current* round
    --     yet, so history only reflects previously processed rounds.
    --
    --     ONLY round_participants.handicap_index is written here.
    --     playing_handicap_used, course_handicap_used,
    --     assigned_playing_handicap, assigned_handicap_index are NOT touched.
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

    -- 2b) Compute handicap_round_results (AGS, SD, derived course_handicap)
    --     for every participant in this round.
    FOR p IN
      SELECT id
      FROM round_participants
      WHERE round_id = r.id
    LOOP
      PERFORM upsert_handicap_round_result(p.id);
    END LOOP;

    -- 2c) Rebuild full HI history for every profile in this round.
    --     recalc_handicap_profile wipes ALL handicap_index_history for the
    --     profile and rebuilds from ciaga_scoring_record_stream (which reads
    --     handicap_round_results). Pre-cutoff results are preserved, so the
    --     stream has complete input. Chronological processing ensures earlier
    --     rounds have already inserted their results.
    FOR p IN
      SELECT DISTINCT profile_id
      FROM round_participants
      WHERE round_id = r.id
        AND profile_id IS NOT NULL
    LOOP
      PERFORM recalc_handicap_profile(p.profile_id);
    END LOOP;

  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.ciaga_refresh_handicaps_from(date) IS
  'Rebuilds the handicap pipeline from p_from_date onwards (or fully if NULL).

   Full mode (NULL): wipes all derived data, replays every finished round.
   Partial mode (date): preserves pre-cutoff data, replays only from that date.

   NEVER modifies these round_participants columns:
     playing_handicap_used, course_handicap_used,
     assigned_playing_handicap, assigned_handicap_index';


-- ============================================================================
-- Backward-compat: delegate the old function to the new one
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ciaga_refresh_handicaps_sequential()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT public.ciaga_refresh_handicaps_from(NULL);
$function$;

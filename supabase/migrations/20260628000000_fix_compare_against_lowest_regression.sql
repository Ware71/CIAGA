-- ============================================================================
-- Fix regression: compare_against_lowest playing handicaps lock to 0.
--
-- Migration 20260624000001 (CREATE OR REPLACE ciaga_resolve_playing_handicap)
-- replaced the entire compare_against_lowest computation with a literal 0,
-- on the false assumption that "the UI/caller handles it". Nothing does:
-- ciaga_persist_playing_handicaps Step 3 only special-cases EVENT-level
-- allowance_pct; a plain round-level compare_against_lowest round falls through
-- to `ELSE ciaga_resolve_playing_handicap(...)`, which then returned 0 for every
-- player. Result: playing_handicap_used = 0 for all participants → matchplay
-- (and any format) played off scratch with no strokes/allowance applied.
--
-- This migration:
--   1. Restores the compare_against_lowest computation (order of operations from
--      20260519000006: allowance % applied to each CH first, then subtract the
--      lowest allowance-adjusted CH across the field), while keeping the
--      20260624000001 structure (assigned_handicap_index already flows through
--      handicap_index via persist Step 1; only assigned_playing_handicap is a
--      direct override here).
--   2. Backfills playing_handicap_used for already-started compare_against_lowest
--      rounds whose values were locked at 0 by the regression.
-- ============================================================================

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
    -- assigned_handicap_index is applied in ciaga_persist_playing_handicaps
    -- Step 1 and flows through handicap_index.
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
        -- Allowance applied to each CH first, then subtract the lowest
        -- allowance-adjusted CH across the field. A stored value of 0 means
        -- 100% (backward compatibility).
        GREATEST(0,
          -- This player's allowance-adjusted CH
          COALESCE(
            round(
              (
                (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
                + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
              ) * COALESCE(NULLIF(r.default_playing_handicap_value, 0), 100) / 100.0
            )::integer,
            0
          )
          -
          -- Minus the lowest allowance-adjusted CH in the round
          COALESCE(
            (
              SELECT MIN(
                COALESCE(
                  round(
                    (
                      (rp2.handicap_index * COALESCE(rts2.slope, 113)::numeric / 113.0)
                      + (COALESCE(rts2.rating, rts2.par_total::numeric) - COALESCE(rts2.par_total, 72))
                    ) * COALESCE(NULLIF(r.default_playing_handicap_value, 0), 100) / 100.0
                  )::integer,
                  0
                )
              )
              FROM public.round_participants rp2
              LEFT JOIN public.round_tee_snapshots rts2 ON rts2.id = rp2.tee_snapshot_id
              WHERE rp2.round_id = p_round_id
                AND rp2.handicap_index IS NOT NULL
            ),
            0
          )
        )

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
   Step 1 (including any assigned_handicap_index override).
   Modes: none=0, fixed=literal value, allowance_pct=CH*%,
   compare_against_lowest=(CH*%) minus min(CH*%) across the field (stored 0 = 100%).';

-- ─── Backfill: repair rounds locked at 0 by the 20260624000001 regression ────
-- Only recomputes playing_handicap_used (leaves handicap_index / course_handicap_used
-- untouched). Idempotent: the corrected resolver matches pre-regression behaviour
-- for this mode, so re-running yields the same values. Skips participants with a
-- manual assigned_playing_handicap override.
UPDATE public.round_participants rp
SET playing_handicap_used = public.ciaga_resolve_playing_handicap(rp.round_id, rp.id)
FROM public.rounds r
WHERE r.id = rp.round_id
  AND r.default_playing_handicap_mode = 'compare_against_lowest'
  AND rp.assigned_playing_handicap IS NULL
  AND rp.tee_snapshot_id IS NOT NULL
  AND r.status IN ('live', 'finished');

-- Format System Overhaul – Part 2: Constraints & functions
--
-- Uses the enum values added in 20260219000000_format_overhaul.sql.
-- Must run as a separate migration so the enum values are committed first.

-- ============================================================
-- 1. Update constraint for new handicap mode
-- ============================================================

ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_handicap_mode_value_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_handicap_mode_value_check CHECK (
  (default_playing_handicap_mode = 'none' AND default_playing_handicap_value = 0) OR
  (default_playing_handicap_mode = 'allowance_pct' AND default_playing_handicap_value BETWEEN 0 AND 100) OR
  (default_playing_handicap_mode = 'fixed' AND default_playing_handicap_value >= 0) OR
  (default_playing_handicap_mode = 'compare_against_lowest' AND default_playing_handicap_value = 0)
);

-- ============================================================
-- 2. Update ciaga_resolve_playing_handicap
-- ============================================================
-- Adds support for 'compare_against_lowest' mode:
--   Each player's course handicap (100% allowance) minus the minimum
--   course handicap in the round. The best player plays off 0,
--   everyone else receives the difference.
--
-- Manual overrides (assigned_handicap_index / assigned_playing_handicap)
-- still take top precedence.

CREATE OR REPLACE FUNCTION public.ciaga_resolve_playing_handicap(
  p_round_id uuid,
  p_participant_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    -- 1. Manual override precedence: prefer assigned_handicap_index (HI), else fall back to legacy assigned_playing_handicap
    (CASE
      WHEN rp.assigned_handicap_index IS NOT NULL THEN ROUND(rp.assigned_handicap_index)::integer
      ELSE rp.assigned_playing_handicap
    END),

    -- 2. Otherwise, use round default calculation
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
        GREATEST(0,
          -- This player's full course handicap
          COALESCE(
            round(
              (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
              + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
            )::integer,
            0
          )
          -
          -- Minus the lowest course handicap in the round
          COALESCE(
            (
              SELECT MIN(
                COALESCE(
                  round(
                    (rp2.handicap_index * COALESCE(rts2.slope, 113)::numeric / 113.0)
                    + (COALESCE(rts2.rating, rts2.par_total::numeric) - COALESCE(rts2.par_total, 72))
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

      ELSE 0  -- 'none' mode or NULL
    END,

    0  -- Fallback to 0 if everything is NULL
  )
  FROM public.round_participants rp
  JOIN public.rounds r ON r.id = rp.round_id
  LEFT JOIN public.round_tee_snapshots rts ON rts.id = rp.tee_snapshot_id
  WHERE rp.round_id = p_round_id
    AND rp.id = p_participant_id;
$$;

COMMENT ON FUNCTION public.ciaga_resolve_playing_handicap IS
  'Resolves the playing handicap for format scoring (NEVER for official HI/AGS calculations).
   Priority: manual override (assigned_handicap_index > assigned_playing_handicap) > round default.
   Modes: none=0, fixed=literal value, allowance_pct=CH*%, compare_against_lowest=CH minus min CH in round.';

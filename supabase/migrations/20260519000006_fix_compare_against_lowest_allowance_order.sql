-- Fix order of operations for compare_against_lowest + allowance %.
-- Previously the allowance was multiplied onto the difference *after* subtracting,
-- which is mathematically equivalent for integer inputs but semantically wrong:
-- the allowance should reduce each player's CH first, then the lowest of those
-- allowance-adjusted values is used as the baseline (scratch), and everyone
-- receives the difference from that baseline.
--
-- Correct order:
--   1. adjusted_CH = round(CH * allowance% / 100)
--   2. baseline    = MIN(adjusted_CH) across all participants
--   3. strokes     = adjusted_CH - baseline

CREATE OR REPLACE FUNCTION public.ciaga_resolve_playing_handicap(
  p_round_id uuid,
  p_participant_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    -- 1. Manual override: prefer assigned_handicap_index (HI), else legacy assigned_playing_handicap
    (CASE
      WHEN rp.assigned_handicap_index IS NOT NULL THEN ROUND(rp.assigned_handicap_index)::integer
      ELSE rp.assigned_playing_handicap
    END),

    -- 2. Round default calculation
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

    0  -- Fallback
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
   Modes: none=0, fixed=literal value, allowance_pct=CH*%, compare_against_lowest=(CH*%) minus min(CH*%).
   Allowance is applied to each player before finding the lowest baseline.
   For compare_against_lowest a stored value of 0 is treated as 100% (backward compatibility).';

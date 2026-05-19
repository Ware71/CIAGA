-- Allow handicap allowance % to be configured when using "Off the Lowest" mode.
-- Previously the constraint forced default_playing_handicap_value = 0 for this mode,
-- meaning the full difference from lowest was always applied (100%). Now 0–100 is
-- permitted and the resolve function treats 0 as 100 for backward compatibility.

-- ============================================================
-- 1. Relax constraint to allow 0–100 for compare_against_lowest
-- ============================================================

ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_handicap_mode_value_check;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_handicap_mode_value_check CHECK (
  (default_playing_handicap_mode = 'none'                   AND default_playing_handicap_value = 0) OR
  (default_playing_handicap_mode = 'allowance_pct'          AND default_playing_handicap_value BETWEEN 0 AND 100) OR
  (default_playing_handicap_mode = 'fixed'                  AND default_playing_handicap_value >= 0) OR
  (default_playing_handicap_mode = 'compare_against_lowest' AND default_playing_handicap_value BETWEEN 0 AND 100)
);

-- ============================================================
-- 2. Update ciaga_resolve_playing_handicap to apply the
--    allowance % in the compare_against_lowest branch.
--    COALESCE(NULLIF(value, 0), 100) means existing rows that
--    stored 0 continue to resolve at 100% (no change in behaviour).
-- ============================================================

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
          round(
            (
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
            )::numeric
            -- Apply allowance %; treat stored 0 as 100% for backward compat
            * COALESCE(NULLIF(r.default_playing_handicap_value, 0), 100) / 100.0
          )::integer
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
   Modes: none=0, fixed=literal value, allowance_pct=CH*%, compare_against_lowest=(CH minus min CH)*%.
   For compare_against_lowest a stored value of 0 is treated as 100% (backward compatibility).';

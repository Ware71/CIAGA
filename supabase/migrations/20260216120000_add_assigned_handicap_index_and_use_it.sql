-- Add assigned_handicap_index to round_participants and update resolve function to prefer it

BEGIN;

-- Add new column for HI override (numeric to allow decimals like 12.3)
ALTER TABLE public.round_participants
  ADD COLUMN IF NOT EXISTS assigned_handicap_index numeric;

-- Update the ciaga_resolve_playing_handicap function to prefer assigned_handicap_index
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
            -- Compute course handicap from HI + slope/rating, then apply allowance %
            (
              (rp.handicap_index * COALESCE(rts.slope, 113)::numeric / 113.0)
              + (COALESCE(rts.rating, rts.par_total::numeric) - COALESCE(rts.par_total, 72))
            ) * r.default_playing_handicap_value / 100.0
          )::integer,
          0
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

-- Backfill: copy existing manual overrides into the new column (non-destructive)
UPDATE public.round_participants
SET assigned_handicap_index = assigned_playing_handicap
WHERE assigned_playing_handicap IS NOT NULL
  AND assigned_handicap_index IS NULL;

COMMIT;

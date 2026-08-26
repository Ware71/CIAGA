-- ============================================================
-- Apply the handicap allowance to the ROUNDED Course Handicap.
--
-- Found while verifying the 20260624000001 event-mode regression against
-- staging. The allowance was never actually lost — the tee-time route copies
-- the event's allowance onto the round itself, so ciaga_resolve_playing_handicap
-- applies it via the round-level path. But the two paths round differently:
--
--   ciaga_persist_playing_handicaps : round(course_handicap_used * pct/100)
--                                     -- allowance on the ROUNDED CH
--   ciaga_resolve_playing_handicap  : round((HI*slope/113 + CR-par) * pct/100)
--                                     -- allowance on the UNROUNDED CH
--
-- WHS rounds the Course Handicap first, then applies the allowance, so the
-- second form is wrong. Measured on staging: 1 of 43 event participants
-- differed, by one stroke (CH=45 at 95% stored 42 where WHS gives 43). It only
-- bites when the raw and rounded CH fall either side of the allowance rounding
-- boundary, which is more likely at high handicaps.
-- ============================================================

-- ── 1. One definition of the WHS Course Handicap ──────────────
-- The expression was written out three times in the function below; naming it
-- keeps the two rounding steps in one place.
CREATE OR REPLACE FUNCTION public.ciaga_course_handicap(
  p_handicap_index numeric,
  p_slope          integer,
  p_rating         numeric,
  p_par_total      integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    round(
      (p_handicap_index * COALESCE(p_slope, 113)::numeric / 113.0)
      + (COALESCE(p_rating, p_par_total::numeric) - COALESCE(p_par_total, 72))
    )::integer,
    0
  );
$$;

COMMENT ON FUNCTION public.ciaga_course_handicap(numeric, integer, numeric, integer) IS
  'WHS Course Handicap: round(HI * slope/113 + (CR - par)). Rounded here so any
   allowance is applied to the rounded value, per WHS.';

-- ── 2. Allowance now applies to the rounded CH ────────────────
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
            public.ciaga_course_handicap(
              rp.handicap_index, rts.slope, rts.rating, rts.par_total
            )::numeric
            * r.default_playing_handicap_value / 100.0
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
              public.ciaga_course_handicap(
                rp.handicap_index, rts.slope, rts.rating, rts.par_total
              )::numeric
              * COALESCE(NULLIF(r.default_playing_handicap_value, 0), 100) / 100.0
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
                    public.ciaga_course_handicap(
                      rp2.handicap_index, rts2.slope, rts2.rating, rts2.par_total
                    )::numeric
                    * COALESCE(NULLIF(r.default_playing_handicap_value, 0), 100) / 100.0
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
  WHERE rp.id = p_participant_id;
$$;

COMMENT ON FUNCTION public.ciaga_resolve_playing_handicap(uuid, uuid) IS
  'Round-level Playing Handicap. Modes: none=0, fixed=literal,
   allowance_pct=round(CH * %), compare_against_lowest=allowance-adjusted CH
   minus the field''s lowest. The allowance applies to the ROUNDED Course
   Handicap (ciaga_course_handicap), per WHS.';

-- ── 3. Re-persist rounds that have not been played yet ────────
-- Deliberately NOT touching finished rounds: their playing handicaps are part
-- of a recorded result. Event leaderboards recompute the allowance themselves
-- (ciaga_compute_event_leaderboard), so finished events were never scored on
-- the wrong value — only the card display was.
DO $$
DECLARE
  v_round_id uuid;
  v_count    integer := 0;
BEGIN
  FOR v_round_id IN
    SELECT DISTINCT r.id
    FROM public.rounds r
    WHERE r.status IN ('draft', 'scheduled', 'starting', 'live')
      AND r.default_playing_handicap_mode IN ('allowance_pct', 'compare_against_lowest')
  LOOP
    PERFORM public.ciaga_persist_playing_handicaps(v_round_id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'allowance rounding: re-persisted % unplayed round(s)', v_count;
END $$;

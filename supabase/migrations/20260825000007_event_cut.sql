-- ============================================================
-- Cut support for multi-round events.
--
-- `cut_config` has existed on event_rules_versions since 20260411000002,
-- labelled "future multi-round support", and was never read by anything. This
-- makes it real: an organiser can say "after round 2, top 10 and ties play on",
-- and the field is marked accordingly when that round completes.
--
-- A cut player keeps their through-the-cut total and takes no further part.
-- They are NOT deleted from the leaderboard — that would erase a result they
-- actually posted.
-- ============================================================

-- ── 1. Config lives on the event the organiser edits ──────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS cut_config jsonb;

COMMENT ON COLUMN public.events.cut_config IS
  'Cut rule, or NULL for no cut. Shape:
     { "after_round": 2, "top_n": 10, "include_ties": true, "within_strokes": null }
   after_round is a round_number. top_n and within_strokes are both optional;
   when both are set a player survives by meeting EITHER.';

-- ── 2. Outcome lives on the entry, which recomputes never ─────
-- event_leaderboard_entries is rebuilt from scratch on every recompute, so the
-- cut result has to live somewhere stable.
ALTER TABLE public.event_entries
  ADD COLUMN IF NOT EXISTS cut_status text
    CHECK (cut_status IS NULL OR cut_status IN ('made', 'missed')),
  ADD COLUMN IF NOT EXISTS cut_applied_at timestamptz;

COMMENT ON COLUMN public.event_entries.cut_status IS
  'NULL until the cut round completes, then made | missed.';

CREATE INDEX IF NOT EXISTS idx_event_entries_cut
  ON public.event_entries(event_id, cut_status);

-- ── 3. Apply the cut ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_apply_event_cut(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg            jsonb;
  v_after_round    integer;
  v_top_n          integer;
  v_include_ties   boolean;
  v_within_strokes integer;
  v_scoring_model  text;
  v_cut_round_id   uuid;
  v_cut_status     text;
  v_marked         integer := 0;
BEGIN
  SELECT e.cut_config, e.scoring_model::text
    INTO v_cfg, v_scoring_model
  FROM events e WHERE e.id = p_event_id;

  IF v_cfg IS NULL THEN
    RETURN 0;
  END IF;

  v_after_round    := (v_cfg->>'after_round')::integer;
  v_top_n          := NULLIF(v_cfg->>'top_n', '')::integer;
  v_include_ties   := COALESCE((v_cfg->>'include_ties')::boolean, true);
  v_within_strokes := NULLIF(v_cfg->>'within_strokes', '')::integer;

  IF v_after_round IS NULL OR (v_top_n IS NULL AND v_within_strokes IS NULL) THEN
    RETURN 0;
  END IF;

  -- The cut only exists once its round is actually complete.
  SELECT er.id, er.status INTO v_cut_round_id, v_cut_status
  FROM event_rounds er
  WHERE er.event_id = p_event_id AND er.round_number = v_after_round;

  IF v_cut_round_id IS NULL OR v_cut_status <> 'completed' THEN
    RETURN 0;
  END IF;

  -- Standings through the cut round. Stableford ranks high-to-low, everything
  -- else low-to-high, so normalise to "lower is better" up front.
  WITH through_cut AS (
    SELECT
      s.profile_id,
      SUM(
        CASE WHEN v_scoring_model = 'stableford_points'
             THEN -COALESCE(rl.format_points, 0)
             ELSE COALESCE(rl.net_score, 0)
        END
      )::numeric AS score,
      COUNT(*)   AS rounds_played
    FROM event_round_submissions s
    JOIN event_rounds er ON er.id = s.event_round_id
    JOIN LATERAL public.ciaga_event_round_leaderboard(er.id) rl
      ON rl.profile_id = s.profile_id
    WHERE s.event_id = p_event_id
      AND s.accepted = true
      AND er.round_number <= v_after_round
    GROUP BY s.profile_id
  ),
  ranked AS (
    SELECT
      tc.profile_id,
      tc.score,
      RANK() OVER (ORDER BY tc.score) AS pos,
      MIN(tc.score) OVER ()           AS leader_score
    FROM through_cut tc
    -- Only players who completed every round up to the cut are ranked; a
    -- no-show cannot survive it.
    WHERE tc.rounds_played >= v_after_round
  ),
  decided AS (
    SELECT
      r.profile_id,
      CASE
        WHEN (
          v_top_n IS NOT NULL
          AND (
            CASE WHEN v_include_ties
                 -- RANK() gives every tied player the same position, so "top 10
                 -- and ties" is simply pos <= 10.
                 THEN r.pos <= v_top_n
                 ELSE ROW_NUMBER() OVER (ORDER BY r.pos, r.profile_id) <= v_top_n
            END
          )
        )
        OR (
          v_within_strokes IS NOT NULL
          AND r.score - r.leader_score <= v_within_strokes
        )
        THEN 'made'
        ELSE 'missed'
      END AS cut_status
    FROM ranked r
  )
  UPDATE event_entries ee
  SET cut_status     = d.cut_status,
      cut_applied_at = now()
  FROM decided d
  WHERE ee.event_id = p_event_id
    AND ee.profile_id = d.profile_id
    AND ee.cut_status IS DISTINCT FROM d.cut_status;

  GET DIAGNOSTICS v_marked = ROW_COUNT;

  -- Anyone entered but not ranked (no card through the cut) misses it.
  UPDATE event_entries ee
  SET cut_status = 'missed', cut_applied_at = now()
  WHERE ee.event_id = p_event_id
    AND ee.cut_status IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM event_round_submissions s
      JOIN event_rounds er ON er.id = s.event_round_id
      WHERE s.event_id = p_event_id
        AND s.profile_id = ee.profile_id
        AND s.accepted = true
        AND er.round_number <= v_after_round
    );

  RETURN v_marked;
END;
$$;

COMMENT ON FUNCTION public.ciaga_apply_event_cut(uuid) IS
  'Marks event_entries.cut_status once the cut round has completed. Idempotent —
   re-running recomputes from the same standings. Returns rows changed.';

GRANT EXECUTE ON FUNCTION public.ciaga_apply_event_cut(uuid) TO service_role;

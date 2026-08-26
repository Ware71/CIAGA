-- ============================================================
-- Round-by-round leaderboard.
--
-- docs/majors.md §B asks for "round-by-round leaderboard and final
-- leaderboard". The cumulative board has always existed; this is the per-round
-- one. The data was already there (event_round_submissions is per round), but
-- nothing exposed a whole field for a single round.
--
-- Scores come from round_effective_scores — the same view the event
-- leaderboard uses — so pick-ups score net double bogey here exactly as they do
-- there, and the two boards cannot disagree about a hole.
--
-- Read-only: unlike ciaga_compute_event_leaderboard this writes nothing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_event_round_leaderboard(p_event_round_id uuid)
RETURNS TABLE(
  profile_id        uuid,
  gross_score       integer,
  net_score         integer,
  format_points     integer,
  course_par        integer,
  to_par            integer,
  holes_completed   integer,
  is_live           boolean,
  submitted         boolean,
  -- Quoted: `position` is a reserved word in a column definition list.
  "position"        integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id       uuid;
  v_scoring_model  text;
  v_handicap_mode  text;
  v_allowance_pct  numeric;
BEGIN
  SELECT er.event_id INTO v_event_id
  FROM event_rounds er WHERE er.id = p_event_round_id;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    e.scoring_model::text,
    COALESCE(e.handicap_rules->>'mode', 'none'),
    COALESCE((e.handicap_rules->>'allowance_pct')::numeric, 100)
  INTO v_scoring_model, v_handicap_mode, v_allowance_pct
  FROM events e WHERE e.id = v_event_id;

  RETURN QUERY
  WITH
  -- Everyone in this round, whether they have submitted or not, so the board
  -- works live as well as after the fact.
  field AS (
    SELECT
      rp.profile_id,
      rp.id            AS participant_id,
      r.id             AS round_id,
      r.status         AS round_status,
      rts.par_total,
      COALESCE(
        (SELECT true FROM event_round_submissions s
          WHERE s.event_id = v_event_id
            AND s.round_id = r.id
            AND s.profile_id = rp.profile_id
            AND s.accepted = true
          LIMIT 1),
        false
      )                AS submitted,
      -- Same allowance precedence as ciaga_compute_event_leaderboard.
      CASE
        WHEN rp.assigned_playing_handicap IS NOT NULL
          THEN rp.assigned_playing_handicap
        WHEN v_handicap_mode = 'allowance_pct'
          THEN round(COALESCE(rp.course_handicap_used, 0)::numeric * v_allowance_pct / 100)::integer
        ELSE COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)
      END              AS hcp
    FROM event_tee_times ett
    JOIN rounds r              ON r.id = ett.round_id
    JOIN round_participants rp ON rp.round_id = r.id
    LEFT JOIN round_tee_snapshots rts ON rts.id = rp.tee_snapshot_id
    WHERE ett.event_round_id = p_event_round_id
      AND r.status <> 'cancelled'
      AND rp.is_guest = false
      AND rp.profile_id IS NOT NULL
  ),

  scored AS (
    SELECT
      f.profile_id,
      f.round_status,
      f.submitted,
      f.par_total,
      f.hcp,
      -- Stableford strokes-received split, as elsewhere: whole sweeps first,
      -- then one extra on the hardest `rem` holes.
      FLOOR(f.hcp::numeric / 18)::integer AS base,
      f.hcp - FLOOR(f.hcp::numeric / 18)::integer * 18 AS rem,
      f.participant_id,
      f.round_id
    FROM field f
  ),

  totals AS (
    SELECT
      s.profile_id,
      s.round_status,
      s.submitted,
      s.par_total,
      s.hcp,
      COALESCE(agg.gross, 0)::integer      AS gross,
      COALESCE(agg.par_sum, 0)::integer    AS par_sum,
      COALESCE(agg.holes, 0)::integer      AS holes,
      COALESCE(agg.pts, 0)::integer        AS pts
    FROM scored s
    LEFT JOIN LATERAL (
      SELECT
        SUM(es.effective_strokes)::integer AS gross,
        SUM(es.par)::integer               AS par_sum,
        COUNT(*)::integer                  AS holes,
        SUM(GREATEST(0, 2 - (
          es.effective_strokes
          - s.base
          - CASE WHEN s.rem > 0 AND es.stroke_index <= s.rem THEN 1 ELSE 0 END
          - es.par
        )))::integer                       AS pts
      FROM round_effective_scores es
      WHERE es.round_id = s.round_id
        AND es.participant_id = s.participant_id
        AND es.counts_as_played
    ) agg ON true
  ),

  ranked AS (
    SELECT
      t.profile_id,
      NULLIF(t.gross, 0)                                       AS gross_score,
      CASE WHEN t.holes > 0 THEN t.gross - t.hcp END::integer   AS net_score,
      CASE WHEN v_scoring_model = 'stableford_points' AND t.holes > 0
           THEN t.pts END::integer                              AS format_points,
      NULLIF(t.par_sum, 0)                                      AS course_par,
      CASE WHEN t.holes > 0 AND t.par_sum > 0
           THEN (t.gross - t.hcp) - t.par_sum END::integer      AS to_par,
      t.holes                                                   AS holes_completed,
      (t.round_status IN ('live', 'starting'))                  AS is_live,
      t.submitted,
      -- Stableford ranks high-to-low; everything else low-to-high. Players
      -- with no holes yet rank last rather than leading on a score of 0.
      RANK() OVER (
        ORDER BY
          CASE WHEN t.holes = 0 THEN 1 ELSE 0 END,
          CASE WHEN v_scoring_model = 'stableford_points'
               THEN -t.pts
               ELSE (t.gross - t.hcp) END
      )::integer                                                AS lb_position
    FROM totals t
  )
  SELECT
    ranked.profile_id,
    ranked.gross_score,
    ranked.net_score,
    ranked.format_points,
    ranked.course_par,
    ranked.to_par,
    ranked.holes_completed,
    ranked.is_live,
    ranked.submitted,
    -- A player with no holes has no position.
    CASE WHEN ranked.holes_completed > 0 THEN ranked.lb_position END
  FROM ranked
  ORDER BY
    CASE WHEN ranked.holes_completed = 0 THEN 1 ELSE 0 END,
    ranked.lb_position;
END;
$$;

COMMENT ON FUNCTION public.ciaga_event_round_leaderboard(uuid) IS
  'Read-only standings for ONE event round: gross, net, stableford points and
   position for every non-guest player in that round, live or finished. Scores
   come from round_effective_scores, so pick-ups score net double bogey exactly
   as they do on the cumulative event leaderboard.';

GRANT EXECUTE ON FUNCTION public.ciaga_event_round_leaderboard(uuid) TO authenticated, service_role;

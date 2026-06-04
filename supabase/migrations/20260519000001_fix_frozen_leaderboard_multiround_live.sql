-- ============================================================
-- Fix: ciaga_get_frozen_leaderboard incorrectly excludes
-- multi-round live players and applies the wrong hole-number
-- threshold for rounds after round 1.
--
-- Bug 1: live_scores excluded ANY player with an accepted
-- submission. In a 2-round competition a player who submitted
-- round 1 but is still live in round 2 was dropped entirely.
-- Fix: mirror the non-frozen leaderboard's pattern —
-- exclude only players who have submitted ALL required rounds
-- (COUNT(*) >= v_num_rounds).
--
-- Bug 2: live_scores filtered by `hole_number <= p_threshold_hole`
-- treating hole numbers as cumulative, but round_score_events
-- stores within-round hole numbers (1-18). For a round-2 live
-- player the threshold must be offset by the number of holes
-- already submitted. A live_offset lateral computes this.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_get_frozen_leaderboard(
  p_competition_id uuid,
  p_threshold_hole integer
)
RETURNS TABLE(
  profile_id              uuid,
  gross_score             integer,
  net_score               integer,
  holes_shown             integer,
  actual_holes_completed  integer,
  is_live                 boolean,
  leaderboard_pos         integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scoring_model text;
  v_higher_better boolean;
  v_num_rounds    integer;
BEGIN
  SELECT scoring_model::text, COALESCE(num_rounds, 1)
    INTO v_scoring_model, v_num_rounds
  FROM competitions WHERE id = p_competition_id;
  v_higher_better := (v_scoring_model = 'stableford_points');

  RETURN QUERY
  WITH

  -- Accepted submissions ordered per player (round 1 = earliest, round 2 = next, ...)
  ranked_subs AS (
    SELECT
      s.profile_id,
      s.round_id,
      ROW_NUMBER() OVER (PARTITION BY s.profile_id ORDER BY s.submitted_at) AS round_num
    FROM competition_round_submissions s
    WHERE s.competition_id = p_competition_id AND s.accepted = true
  ),

  -- Per-submission details: cumulative hole range and final scores
  sub_details AS (
    SELECT
      rs.profile_id,
      rs.round_num,
      rs.round_id,
      (rs.round_num - 1) * 18                               AS range_start, -- 0-indexed
      rs.round_num * 18                                     AS range_end,   -- inclusive
      hrr.adjusted_gross_score                              AS full_gross,
      COALESCE(rp.course_handicap_used, 0)                  AS full_hcp
    FROM ranked_subs rs
    JOIN round_participants rp
      ON rp.round_id = rs.round_id AND rp.profile_id = rs.profile_id
    JOIN handicap_round_results hrr
      ON hrr.participant_id = rp.id
  ),

  -- Classify each round: full (all holes within threshold), partial (straddles), or hidden
  player_rounds AS (
    SELECT
      *,
      CASE
        WHEN range_end   <= p_threshold_hole THEN 'full'
        WHEN range_start <  p_threshold_hole THEN 'partial'
        ELSE 'hidden'
      END AS inclusion
    FROM sub_details
  ),

  -- Sum full rounds per player
  full_scores AS (
    SELECT
      profile_id,
      SUM(full_gross)::integer                       AS gross,
      SUM(full_hcp)::integer                         AS hcp,
      SUM(range_end - range_start)::integer          AS holes,
      SUM(range_end - range_start)::integer          AS actual_holes
    FROM player_rounds
    WHERE inclusion = 'full'
    GROUP BY profile_id
  ),

  -- For the partial round, sum hole scores up to the threshold hole of that round.
  -- actual_holes = the full submitted round (range_end - range_start = 18).
  partial_scores AS (
    SELECT
      pr.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(pr.full_hcp * COALESCE(scores.hole_count, 0) / 18.0)::integer       AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                    AS holes,
      (pr.range_end - pr.range_start)::integer                                   AS actual_holes
    FROM player_rounds pr
    JOIN round_participants rp
      ON rp.round_id = pr.round_id AND rp.profile_id = pr.profile_id
    LEFT JOIN LATERAL (
      SELECT
        SUM(s.strokes)  AS strokes,
        COUNT(*)        AS hole_count
      FROM (
        SELECT DISTINCT ON (rse.hole_number)
          rse.hole_number,
          rse.strokes
        FROM round_score_events rse
        WHERE rse.round_id = pr.round_id
          AND rse.participant_id = rp.id
          AND rse.hole_number <= (p_threshold_hole - pr.range_start)
        ORDER BY rse.hole_number, rse.created_at DESC
      ) s
    ) scores ON true
    WHERE pr.inclusion = 'partial'
  ),

  -- In-progress players: score through threshold hole.
  -- live_offset computes the cumulative hole offset from already-accepted
  -- submissions so that hole_number (1-18, within-round) is correctly
  -- mapped to the competition-wide threshold.
  -- Excludes players who have submitted ALL required rounds.
  live_scores AS (
    SELECT
      rp.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(COALESCE(rp.course_handicap_used, 0)
            * COALESCE(scores.hole_count, 0) / 18.0)::integer                  AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                   AS holes,
      COALESCE(uncapped.hole_count, 0)::integer                                 AS actual_holes
    FROM competition_tee_times ctt
    JOIN rounds r
      ON r.competition_tee_time_id = ctt.id
      AND r.status IN ('scheduled', 'live')
    JOIN round_participants rp
      ON rp.round_id = r.id
    -- Cumulative hole offset: number of accepted submissions × 18
    JOIN LATERAL (
      SELECT COALESCE(COUNT(*), 0) * 18 AS range_start
      FROM competition_round_submissions s3
      WHERE s3.competition_id = p_competition_id
        AND s3.profile_id = rp.profile_id
        AND s3.accepted = true
    ) live_offset ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(s.strokes)  AS strokes,
        COUNT(*)        AS hole_count
      FROM (
        SELECT DISTINCT ON (rse.hole_number)
          rse.hole_number,
          rse.strokes
        FROM round_score_events rse
        WHERE rse.round_id = r.id
          AND rse.participant_id = rp.id
          AND rse.hole_number <= (p_threshold_hole - live_offset.range_start)
        ORDER BY rse.hole_number, rse.created_at DESC
      ) s
    ) scores ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT rse2.hole_number) AS hole_count
      FROM round_score_events rse2
      WHERE rse2.round_id = r.id
        AND rse2.participant_id = rp.id
    ) uncapped ON true
    WHERE ctt.competition_id = p_competition_id
      AND rp.profile_id NOT IN (
        SELECT s2.profile_id
        FROM competition_round_submissions s2
        WHERE s2.competition_id = p_competition_id AND s2.accepted = true
        GROUP BY s2.profile_id
        HAVING COUNT(*) >= v_num_rounds
      )
  ),

  -- Combine all score sources per player
  combined AS (
    SELECT
      pid,
      SUM(gross)::integer                  AS gross_score,
      SUM(gross - hcp)::integer            AS net_score,
      SUM(holes)::integer                  AS holes_shown,
      SUM(actual_holes)::integer           AS actual_holes_completed,
      bool_or(is_live)                     AS is_live
    FROM (
      SELECT profile_id AS pid, gross, hcp, holes, actual_holes, false AS is_live
        FROM full_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, actual_holes, false
        FROM partial_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, actual_holes, true
        FROM live_scores
    ) all_scores
    GROUP BY pid
    HAVING SUM(holes) > 0
  )

  SELECT
    c.pid,
    c.gross_score,
    c.net_score,
    c.holes_shown,
    c.actual_holes_completed,
    c.is_live,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN NOT v_higher_better THEN c.net_score END ASC  NULLS LAST,
        CASE WHEN v_higher_better     THEN c.net_score END DESC NULLS LAST,
        c.holes_shown DESC,
        c.pid ASC
    )::integer AS leaderboard_pos
  FROM combined c;
END;
$$;

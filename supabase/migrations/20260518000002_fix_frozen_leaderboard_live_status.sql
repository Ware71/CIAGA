-- ============================================================
-- Fix: ciaga_get_frozen_leaderboard used 'in_progress' round
-- status (not a valid enum value) instead of 'live'. This was
-- re-introduced when 20260518000001 rebuilt the function with
-- the new actual_holes_completed return column.
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
BEGIN
  SELECT scoring_model::text INTO v_scoring_model
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
  -- actual_holes = holes (all within threshold, so shown = actual)
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

  -- In-progress players (no accepted submissions yet): score through threshold hole.
  -- actual_holes = uncapped count of distinct holes entered so far.
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
          AND rse.hole_number <= p_threshold_hole
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
        SELECT DISTINCT s2.profile_id
        FROM competition_round_submissions s2
        WHERE s2.competition_id = p_competition_id AND s2.accepted = true
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

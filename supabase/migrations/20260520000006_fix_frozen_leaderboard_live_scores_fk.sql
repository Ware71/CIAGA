-- ============================================================
-- Fix: ciaga_get_frozen_leaderboard live_scores CTE used
-- r.id = ctt.round_id (forward FK only). Any round where
-- competition_tee_times.round_id is NULL (created after the
-- 20260520000001 backfill ran, via a code path that only sets
-- rounds.competition_tee_time_id) is found by
-- ciaga_compute_competition_leaderboard (which uses COALESCE)
-- but missed by the frozen function → blank frozen leaderboard.
--
-- Fix: mirror the COALESCE(ctt.round_id, back-link) pattern
-- already used in ciaga_compute_competition_leaderboard so both
-- functions resolve the same set of live rounds.
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
      (rs.round_num - 1) * 18                               AS range_start,
      rs.round_num * 18                                     AS range_end,
      hrr.adjusted_gross_score                              AS full_gross,
      COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0) AS full_hcp
    FROM ranked_subs rs
    JOIN round_participants rp
      ON rp.round_id = rs.round_id AND rp.profile_id = rs.profile_id
    JOIN handicap_round_results hrr
      ON hrr.participant_id = rp.id
  ),

  -- Classify each round: full (within threshold), partial (straddles), hidden
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

  -- Sum full rounds per player.
  -- pts: per-hole stableford points for the entire submitted round
  --      (all holes within threshold so all count); 0 for stroke play.
  full_scores AS (
    SELECT
      pr.profile_id,
      SUM(pr.full_gross)::integer                    AS gross,
      SUM(pr.full_hcp)::integer                      AS hcp,
      SUM(pr.range_end - pr.range_start)::integer    AS holes,
      SUM(pr.range_end - pr.range_start)::integer    AS actual_holes,
      COALESCE(SUM(stab.pts), 0)::integer            AS pts
    FROM player_rounds pr
    JOIN round_participants rp
      ON rp.round_id = pr.round_id AND rp.profile_id = pr.profile_id
    LEFT JOIN round_tee_snapshots rts ON rts.id = rp.tee_snapshot_id
    CROSS JOIN LATERAL (
      VALUES (COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))
    ) hv(hcp)
    CROSS JOIN LATERAL (
      VALUES (FLOOR(hv.hcp::numeric / 18)::integer)
    ) hb(base)
    CROSS JOIN LATERAL (
      VALUES (hv.hcp - hb.base * 18)
    ) hr(rem)
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(GREATEST(0, 2 - (
        ls.strokes
        - hb.base
        - CASE WHEN rhs.stroke_index <= hr.rem THEN 1 ELSE 0 END
        - rhs.par
      ))), 0) AS pts
      FROM (
        SELECT DISTINCT ON (rse.hole_number) rse.hole_number, rse.strokes
        FROM round_score_events rse
        WHERE rse.round_id = pr.round_id
          AND rse.participant_id = rp.id
        ORDER BY rse.hole_number, rse.created_at DESC
      ) ls
      JOIN round_hole_snapshots rhs
        ON rhs.round_tee_snapshot_id = rts.id
       AND rhs.hole_number = ls.hole_number
      WHERE v_scoring_model = 'stableford_points'
    ) stab ON true
    WHERE pr.inclusion = 'full'
    GROUP BY pr.profile_id
  ),

  -- Partial round: sum hole scores up to threshold.
  -- actual_holes = full submitted round size (18).
  -- pts: stableford points for holes 1..threshold within this round.
  partial_scores AS (
    SELECT
      pr.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(pr.full_hcp * COALESCE(scores.hole_count, 0) / 18.0)::integer       AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                    AS holes,
      (pr.range_end - pr.range_start)::integer                                   AS actual_holes,
      COALESCE(stab.pts, 0)::integer                                             AS pts
    FROM player_rounds pr
    JOIN round_participants rp
      ON rp.round_id = pr.round_id AND rp.profile_id = pr.profile_id
    LEFT JOIN round_tee_snapshots rts ON rts.id = rp.tee_snapshot_id
    CROSS JOIN LATERAL (
      VALUES (COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))
    ) hv(hcp)
    CROSS JOIN LATERAL (
      VALUES (FLOOR(hv.hcp::numeric / 18)::integer)
    ) hb(base)
    CROSS JOIN LATERAL (
      VALUES (hv.hcp - hb.base * 18)
    ) hr(rem)
    LEFT JOIN LATERAL (
      SELECT
        SUM(s.strokes)  AS strokes,
        COUNT(*)        AS hole_count
      FROM (
        SELECT DISTINCT ON (rse.hole_number) rse.hole_number, rse.strokes
        FROM round_score_events rse
        WHERE rse.round_id = pr.round_id
          AND rse.participant_id = rp.id
          AND rse.hole_number <= (p_threshold_hole - pr.range_start)
        ORDER BY rse.hole_number, rse.created_at DESC
      ) s
    ) scores ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(GREATEST(0, 2 - (
        ls.strokes
        - hb.base
        - CASE WHEN rhs.stroke_index <= hr.rem THEN 1 ELSE 0 END
        - rhs.par
      ))), 0) AS pts
      FROM (
        SELECT DISTINCT ON (rse.hole_number) rse.hole_number, rse.strokes
        FROM round_score_events rse
        WHERE rse.round_id = pr.round_id
          AND rse.participant_id = rp.id
          AND rse.hole_number <= (p_threshold_hole - pr.range_start)
        ORDER BY rse.hole_number, rse.created_at DESC
      ) ls
      JOIN round_hole_snapshots rhs
        ON rhs.round_tee_snapshot_id = rts.id
       AND rhs.hole_number = ls.hole_number
      WHERE v_scoring_model = 'stableford_points'
    ) stab ON true
    WHERE pr.inclusion = 'partial'
  ),

  -- In-progress players: score through threshold hole.
  -- FIX: use COALESCE(ctt.round_id, back-link) so rounds where only
  --      rounds.competition_tee_time_id is set (not ctt.round_id) are
  --      still found — matching the pattern in
  --      ciaga_compute_competition_leaderboard.
  -- live_offset: cumulative submitted holes so within-round hole numbers
  --   map correctly to the competition-wide threshold.
  -- Excludes players who have submitted ALL required rounds.
  live_scores AS (
    SELECT
      rp.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)
            * COALESCE(scores.hole_count, 0) / 18.0)::integer                  AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                   AS holes,
      COALESCE(uncapped.hole_count, 0)::integer                                 AS actual_holes,
      COALESCE(stab.pts, 0)::integer                                            AS pts
    FROM competition_tee_times ctt
    -- FIX: COALESCE so rounds where ctt.round_id is NULL are found
    --      via the rounds.competition_tee_time_id back-link.
    JOIN rounds r
      ON r.id = COALESCE(
           ctt.round_id,
           (SELECT r2.id FROM rounds r2
            WHERE r2.competition_tee_time_id = ctt.id
            LIMIT 1)
         )
      AND r.status IN ('scheduled', 'live')
    JOIN round_participants rp
      ON rp.round_id = r.id
    LEFT JOIN round_tee_snapshots rts ON rts.id = rp.tee_snapshot_id
    CROSS JOIN LATERAL (
      VALUES (COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))
    ) hv(hcp)
    CROSS JOIN LATERAL (
      VALUES (FLOOR(hv.hcp::numeric / 18)::integer)
    ) hb(base)
    CROSS JOIN LATERAL (
      VALUES (hv.hcp - hb.base * 18)
    ) hr(rem)
    -- Cumulative hole offset: accepted submissions × 18
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
        SELECT DISTINCT ON (rse.hole_number) rse.hole_number, rse.strokes
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
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(GREATEST(0, 2 - (
        ls.strokes
        - hb.base
        - CASE WHEN rhs.stroke_index <= hr.rem THEN 1 ELSE 0 END
        - rhs.par
      ))), 0) AS pts
      FROM (
        SELECT DISTINCT ON (rse.hole_number) rse.hole_number, rse.strokes
        FROM round_score_events rse
        WHERE rse.round_id = r.id
          AND rse.participant_id = rp.id
          AND rse.hole_number <= (p_threshold_hole - live_offset.range_start)
        ORDER BY rse.hole_number, rse.created_at DESC
      ) ls
      JOIN round_hole_snapshots rhs
        ON rhs.round_tee_snapshot_id = rts.id
       AND rhs.hole_number = ls.hole_number
      WHERE v_scoring_model = 'stableford_points'
    ) stab ON true
    WHERE ctt.competition_id = p_competition_id
      AND rp.profile_id NOT IN (
        SELECT s2.profile_id
        FROM competition_round_submissions s2
        WHERE s2.competition_id = p_competition_id AND s2.accepted = true
        GROUP BY s2.profile_id
        HAVING COUNT(*) >= v_num_rounds
      )
  ),

  -- Combine all score sources per player.
  -- net_score: stableford points (SUM pts) when v_higher_better,
  --            net strokes (SUM gross - hcp) for stroke play.
  combined AS (
    SELECT
      pid,
      SUM(gross)::integer                                             AS gross_score,
      CASE WHEN v_higher_better
        THEN SUM(pts)::integer
        ELSE SUM(gross - hcp)::integer
      END                                                             AS net_score,
      SUM(holes)::integer                                             AS holes_shown,
      SUM(actual_holes)::integer                                      AS actual_holes_completed,
      bool_or(is_live)                                                AS is_live
    FROM (
      SELECT profile_id AS pid, gross, hcp, holes, actual_holes, pts, false AS is_live
        FROM full_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, actual_holes, pts, false
        FROM partial_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, actual_holes, pts, true
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

-- ============================================================
-- Fix: replace invalid 'in_progress' round_status with 'live'
-- in leaderboard functions. 'in_progress' does not exist in
-- the round_status enum; the correct value for an active round is 'live'.
-- ============================================================

-- ── ciaga_compute_competition_leaderboard (fixed) ─────────────
CREATE OR REPLACE FUNCTION public.ciaga_compute_competition_leaderboard(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scoring_model  text;
  v_higher_better  boolean;
  v_num_rounds     integer;
  v_group_id       uuid;
  v_season_id      uuid;
  v_contribution   text;
BEGIN
  SELECT scoring_model::text, num_rounds, group_id, season_id, standings_contribution
    INTO v_scoring_model, v_num_rounds, v_group_id, v_season_id, v_contribution
  FROM competitions
  WHERE id = p_competition_id;

  v_higher_better := (v_scoring_model = 'stableford_points');
  v_num_rounds    := COALESCE(v_num_rounds, 1);

  DELETE FROM competition_leaderboard_entries
  WHERE competition_id = p_competition_id;

  INSERT INTO competition_leaderboard_entries
    (competition_id, profile_id, gross_score, net_score, format_points,
     rounds_submitted, last_submission_at, is_live, holes_completed, position, computed_at)
  SELECT
    p_competition_id,
    agg.profile_id,
    agg.gross_score,
    agg.net_score,
    NULL AS format_points,
    agg.rounds_submitted,
    agg.last_submission_at,
    agg.is_live,
    agg.holes_completed,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN NOT v_higher_better THEN agg.net_score END ASC NULLS LAST,
        CASE WHEN v_higher_better     THEN agg.net_score END DESC NULLS LAST,
        agg.holes_completed DESC,
        agg.last_submission_at ASC NULLS LAST
    ) AS position,
    NOW() AS computed_at
  FROM (
    WITH
    -- Accepted/submitted rounds per player
    submitted AS (
      SELECT
        s.profile_id,
        SUM(hrr.adjusted_gross_score)::integer                            AS submitted_gross,
        SUM(COALESCE(rp.course_handicap_used, 0))::integer                AS submitted_hcp,
        SUM(CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END)::integer          AS submitted_holes,
        COUNT(*)::integer                                                  AS rounds_submitted,
        MAX(s.submitted_at)                                                AS last_submission_at
      FROM competition_round_submissions s
      JOIN round_participants rp
        ON rp.round_id = s.round_id AND rp.profile_id = s.profile_id
      JOIN handicap_round_results hrr
        ON hrr.participant_id = rp.id
      WHERE s.competition_id = p_competition_id
        AND s.accepted = true
      GROUP BY s.profile_id
    ),

    -- In-progress rounds (not yet submitted) linked via competition tee times
    live_rounds AS (
      SELECT
        rp.profile_id,
        COALESCE(scores.total_strokes, 0)::integer   AS live_gross,
        COALESCE(scores.hole_count, 0)::integer      AS live_holes,
        COALESCE(rp.course_handicap_used, 0)         AS course_hcp
      FROM competition_tee_times ctt
      JOIN rounds r
        ON r.competition_tee_time_id = ctt.id
        AND r.status = 'live'
      JOIN round_participants rp
        ON rp.round_id = r.id
      LEFT JOIN LATERAL (
        SELECT
          SUM(latest.strokes) AS total_strokes,
          COUNT(*)            AS hole_count
        FROM (
          SELECT DISTINCT ON (rse.hole_number)
            rse.hole_number,
            rse.strokes
          FROM round_score_events rse
          WHERE rse.round_id = r.id
            AND rse.participant_id = rp.id
          ORDER BY rse.hole_number, rse.created_at DESC
        ) latest
      ) scores ON true
      WHERE ctt.competition_id = p_competition_id
        -- Exclude players already fully submitted for all expected rounds
        AND rp.profile_id NOT IN (
          SELECT s2.profile_id
          FROM competition_round_submissions s2
          WHERE s2.competition_id = p_competition_id
            AND s2.accepted = true
          GROUP BY s2.profile_id
          HAVING COUNT(*) >= v_num_rounds
        )
    )

    SELECT
      COALESCE(sub.profile_id, live.profile_id)                                AS profile_id,
      COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)          AS gross_score,
      COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)
        - COALESCE(sub.submitted_hcp, 0)
        - FLOOR(COALESCE(live.course_hcp, 0)
            * COALESCE(live.live_holes, 0) / 18.0)::integer                    AS net_score,
      COALESCE(sub.rounds_submitted, 0)                                        AS rounds_submitted,
      sub.last_submission_at,
      (live.profile_id IS NOT NULL AND COALESCE(live.live_holes, 0) > 0)       AS is_live,
      (COALESCE(sub.submitted_holes, 0) + COALESCE(live.live_holes, 0))        AS holes_completed
    FROM submitted sub
    FULL OUTER JOIN live_rounds live ON live.profile_id = sub.profile_id
    WHERE COALESCE(sub.rounds_submitted, 0) > 0
       OR COALESCE(live.live_holes, 0) > 0
  ) agg;

  -- Cascade to group standings (only affects output when competition is 'completed')
  IF v_group_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_group_standings(v_group_id);
  END IF;

  -- Cascade to season standings
  IF v_season_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_season_standings(v_season_id);
  END IF;
END;
$$;

-- ── ciaga_get_frozen_leaderboard (fixed) ──────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_get_frozen_leaderboard(
  p_competition_id uuid,
  p_threshold_hole integer
)
RETURNS TABLE(
  profile_id        uuid,
  gross_score       integer,
  net_score         integer,
  holes_shown       integer,
  is_live           boolean,
  leaderboard_pos   integer
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
  full_scores AS (
    SELECT
      profile_id,
      SUM(full_gross)::integer   AS gross,
      SUM(full_hcp)::integer     AS hcp,
      SUM(range_end - range_start)::integer AS holes
    FROM player_rounds
    WHERE inclusion = 'full'
    GROUP BY profile_id
  ),

  -- For the partial round, sum hole scores up to the threshold hole of that round
  partial_scores AS (
    SELECT
      pr.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(pr.full_hcp * COALESCE(scores.hole_count, 0) / 18.0)::integer       AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                    AS holes
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

  -- In-progress players (no accepted submissions yet): score through threshold hole
  live_scores AS (
    SELECT
      rp.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(COALESCE(rp.course_handicap_used, 0)
            * COALESCE(scores.hole_count, 0) / 18.0)::integer                  AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                   AS holes
    FROM competition_tee_times ctt
    JOIN rounds r
      ON r.competition_tee_time_id = ctt.id
      AND r.status = 'live'
    JOIN round_participants rp
      ON rp.round_id = r.id
    LEFT JOIN LATERAL (
      SELECT SUM(s.strokes) AS strokes, COUNT(*) AS hole_count
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
      SUM(gross)::integer            AS gross_score,
      SUM(gross - hcp)::integer      AS net_score,
      SUM(holes)::integer            AS holes_shown,
      bool_or(is_live)               AS is_live
    FROM (
      SELECT profile_id AS pid, gross, hcp, holes, false AS is_live
        FROM full_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, false
        FROM partial_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, true
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

-- ============================================================
-- Leaderboard freeze: ceremony reveal feature
-- Adds freeze configuration and state to competitions, plus
-- a function for computing scores truncated at a hole threshold.
-- ============================================================

-- ── New columns on competitions ───────────────────────────────
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS leaderboard_freeze_last_holes integer
    CHECK (leaderboard_freeze_last_holes IS NULL OR leaderboard_freeze_last_holes > 0),
  ADD COLUMN IF NOT EXISTS leaderboard_freeze_scope text NOT NULL DEFAULT 'all'
    CHECK (leaderboard_freeze_scope IN ('all', 'top_x')),
  ADD COLUMN IF NOT EXISTS leaderboard_freeze_top_x integer
    CHECK (leaderboard_freeze_top_x IS NULL OR leaderboard_freeze_top_x > 0),
  ADD COLUMN IF NOT EXISTS leaderboard_freeze_auto_reveal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leaderboard_freeze_state text NOT NULL DEFAULT 'live'
    CHECK (leaderboard_freeze_state IN ('live', 'frozen', 'revealed')),
  ADD COLUMN IF NOT EXISTS leaderboard_reveal_style text NOT NULL DEFAULT 'none'
    CHECK (leaderboard_reveal_style IN ('none', 'animated')),
  ADD COLUMN IF NOT EXISTS leaderboard_reveal_top_x integer
    CHECK (leaderboard_reveal_top_x IS NULL OR leaderboard_reveal_top_x > 0);

-- ── ciaga_get_frozen_leaderboard ──────────────────────────────
-- Computes per-player scores truncated at p_threshold_hole total holes.
-- Used when leaderboard_freeze_state = 'frozen'.
--
-- For each player:
--   - Rounds fully within threshold: use handicap_round_results (canonical)
--   - Round straddling the threshold: query round_score_events up to the threshold hole
--   - In-progress round (not yet submitted): query round_score_events up to threshold
--
-- Rounds are ordered by submission time to determine round 1, round 2, etc.
-- Each round is assumed to be 18 holes (9-hole rounds use is_9_hole flag).
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
      AND r.status IN ('scheduled', 'in_progress')
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

-- ── ciaga_check_leaderboard_auto_reveal ───────────────────────
-- Called after each submission. If all entered players have
-- submitted all rounds and auto_reveal is enabled, transition
-- freeze_state frozen → revealed.
CREATE OR REPLACE FUNCTION public.ciaga_check_leaderboard_auto_reveal(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_freeze_state  text;
  v_auto_reveal   boolean;
  v_num_rounds    integer;
  v_total_entered integer;
  v_fully_done    integer;
BEGIN
  SELECT leaderboard_freeze_state, leaderboard_freeze_auto_reveal, num_rounds
    INTO v_freeze_state, v_auto_reveal, v_num_rounds
  FROM competitions
  WHERE id = p_competition_id;

  IF v_freeze_state IS DISTINCT FROM 'frozen' OR NOT COALESCE(v_auto_reveal, false) THEN
    RETURN;
  END IF;

  v_num_rounds := COALESCE(v_num_rounds, 1);

  SELECT COUNT(*) INTO v_total_entered
  FROM competition_entries
  WHERE competition_id = p_competition_id;

  SELECT COUNT(*) INTO v_fully_done
  FROM (
    SELECT profile_id
    FROM competition_round_submissions
    WHERE competition_id = p_competition_id AND accepted = true
    GROUP BY profile_id
    HAVING COUNT(*) >= v_num_rounds
  ) finished;

  IF v_total_entered > 0 AND v_fully_done >= v_total_entered THEN
    UPDATE competitions
    SET leaderboard_freeze_state = 'revealed'
    WHERE id = p_competition_id;
  END IF;
END;
$$;

-- ── Update ciaga_accept_round_submission to check auto-reveal ─
CREATE OR REPLACE FUNCTION public.ciaga_accept_round_submission(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_competition_id uuid;
  v_group_id       uuid;
  v_profile_id     uuid;
BEGIN
  UPDATE competition_round_submissions
  SET
    accepted          = true,
    rejected_reason   = NULL,
    submission_status = 'accepted',
    decided_at        = NOW()
  WHERE id = p_submission_id
  RETURNING competition_id, profile_id INTO v_competition_id, v_profile_id;

  IF v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found: %', p_submission_id;
  END IF;

  PERFORM ciaga_compute_competition_leaderboard(v_competition_id);

  -- Refresh group standings if this competition contributes
  SELECT group_id INTO v_group_id
  FROM competitions
  WHERE id = v_competition_id
    AND standings_contribution IN ('season', 'both');

  IF v_group_id IS NOT NULL THEN
    PERFORM ciaga_compute_group_standings(v_group_id);
  END IF;

  INSERT INTO competition_audit_log (competition_id, actor_profile_id, action_type, payload)
  VALUES (
    v_competition_id,
    v_profile_id,
    'submission_accepted',
    jsonb_build_object('submission_id', p_submission_id)
  );

  PERFORM ciaga_check_leaderboard_auto_reveal(v_competition_id);
END;
$$;

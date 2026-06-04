-- CIAGA Majors: DB functions for leaderboard and standings computation

-- Compute leaderboard for a single competition
-- Called after each accepted round submission and when a competition is finished.
CREATE OR REPLACE FUNCTION public.ciaga_compute_competition_leaderboard(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scoring_model text;
  v_higher_better boolean;
BEGIN
  SELECT scoring_model::text INTO v_scoring_model
  FROM competitions
  WHERE id = p_competition_id;

  -- Stableford = higher is better; gross/net = lower is better
  v_higher_better := (v_scoring_model = 'stableford_points');

  -- Delete existing entries and recompute (simpler than upsert with position recalculation)
  DELETE FROM competition_leaderboard_entries
  WHERE competition_id = p_competition_id;

  INSERT INTO competition_leaderboard_entries
    (competition_id, profile_id, gross_score, net_score, format_points, rounds_submitted,
     last_submission_at, position, computed_at)
  SELECT
    p_competition_id,
    agg.profile_id,
    agg.gross_score,
    agg.net_score,
    NULL AS format_points,
    agg.rounds_submitted,
    agg.last_submission_at,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN NOT v_higher_better THEN agg.net_score END ASC,
        CASE WHEN v_higher_better THEN agg.net_score END DESC,
        agg.last_submission_at ASC  -- tiebreak: earlier submission wins
    ) AS position,
    NOW() AS computed_at
  FROM (
    SELECT
      s.profile_id,
      SUM(hrr.adjusted_gross_score)::integer AS gross_score,
      SUM(hrr.adjusted_gross_score - COALESCE(rp.course_handicap_used, 0))::integer AS net_score,
      COUNT(*)::integer AS rounds_submitted,
      MAX(s.submitted_at) AS last_submission_at
    FROM competition_round_submissions s
    JOIN round_participants rp
      ON rp.round_id = s.round_id
      AND rp.profile_id = s.profile_id
    JOIN handicap_round_results hrr
      ON hrr.participant_id = rp.id
    WHERE s.competition_id = p_competition_id
      AND s.accepted = true
    GROUP BY s.profile_id
  ) agg;
END;
$$;

-- Compute group/season standings for all active members across competitions in a group.
-- Call after ciaga_compute_competition_leaderboard when a competition in this group is updated.
CREATE OR REPLACE FUNCTION public.ciaga_compute_group_standings(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM major_group_standings
  WHERE group_id = p_group_id;

  INSERT INTO major_group_standings
    (group_id, profile_id, season_points, events_played, wins, position, computed_at)
  SELECT
    p_group_id,
    agg.profile_id,
    COALESCE(SUM(agg.points_earned), 0) AS season_points,
    COUNT(DISTINCT agg.competition_id) AS events_played,
    COUNT(*) FILTER (WHERE agg.position = 1) AS wins,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(SUM(agg.points_earned), 0) DESC,
               COUNT(*) FILTER (WHERE agg.position = 1) DESC
    ) AS position,
    NOW()
  FROM competition_leaderboard_entries agg
  JOIN competitions c ON c.id = agg.competition_id
  WHERE c.group_id = p_group_id
    AND c.standings_contribution IN ('season', 'both')
    AND c.majors_status = 'completed'
  GROUP BY agg.profile_id;
END;
$$;

-- Accept a round submission and trigger leaderboard recompute.
-- Convenience function called from the submit-round API route.
CREATE OR REPLACE FUNCTION public.ciaga_accept_round_submission(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_competition_id uuid;
  v_group_id uuid;
BEGIN
  UPDATE competition_round_submissions
  SET accepted = true, rejected_reason = NULL
  WHERE id = p_submission_id
  RETURNING competition_id INTO v_competition_id;

  IF v_competition_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found: %', p_submission_id;
  END IF;

  PERFORM ciaga_compute_competition_leaderboard(v_competition_id);

  -- Also refresh group standings if this competition contributes
  SELECT group_id INTO v_group_id
  FROM competitions
  WHERE id = v_competition_id
    AND standings_contribution IN ('season', 'both');

  IF v_group_id IS NOT NULL THEN
    PERFORM ciaga_compute_group_standings(v_group_id);
  END IF;
END;
$$;

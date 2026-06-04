-- ============================================================
-- Leaderboard auto-freeze: automatically transition
-- leaderboard_freeze_state from 'live' → 'frozen' when any
-- player reaches total_holes - freeze_last_holes holes completed.
-- ============================================================

-- ── ciaga_check_leaderboard_auto_freeze ──────────────────────
-- Called at the end of every leaderboard recompute. If the
-- competition has freeze configured and any player's
-- holes_completed has reached the threshold, freeze it.
CREATE OR REPLACE FUNCTION public.ciaga_check_leaderboard_auto_freeze(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_freeze_state      text;
  v_freeze_last_holes integer;
  v_num_rounds        integer;
  v_threshold         integer;
  v_max_holes         integer;
BEGIN
  SELECT leaderboard_freeze_state, leaderboard_freeze_last_holes, num_rounds
    INTO v_freeze_state, v_freeze_last_holes, v_num_rounds
  FROM competitions
  WHERE id = p_competition_id;

  IF v_freeze_state IS DISTINCT FROM 'live' OR v_freeze_last_holes IS NULL THEN
    RETURN;
  END IF;

  v_num_rounds := COALESCE(v_num_rounds, 1);
  v_threshold  := v_num_rounds * 18 - v_freeze_last_holes;

  SELECT MAX(holes_completed) INTO v_max_holes
  FROM competition_leaderboard_entries
  WHERE competition_id = p_competition_id;

  IF v_max_holes IS NOT NULL AND v_max_holes >= v_threshold THEN
    UPDATE competitions
    SET leaderboard_freeze_state = 'frozen'
    WHERE id = p_competition_id
      AND leaderboard_freeze_state = 'live';
  END IF;
END;
$$;

-- ── Updated ciaga_compute_competition_leaderboard ─────────────
-- Identical to 20260514000002 but calls ciaga_check_leaderboard_auto_freeze
-- at the end so every score event, submission accept, and round finish
-- can trigger an automatic freeze.
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
        SUM(hrr.adjusted_gross_score)::integer                                        AS submitted_gross,
        SUM(COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))::integer  AS submitted_hcp,
        SUM(CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END)::integer                      AS submitted_holes,
        COUNT(*)::integer                                                              AS rounds_submitted,
        MAX(s.submitted_at)                                                            AS last_submission_at
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
        COALESCE(scores.total_strokes, 0)::integer                              AS live_gross,
        COALESCE(scores.hole_count, 0)::integer                                 AS live_holes,
        COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)          AS course_hcp
      FROM competition_tee_times ctt
      JOIN rounds r
        ON r.competition_tee_time_id = ctt.id
        AND r.status IN ('scheduled', 'live')
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

  PERFORM ciaga_check_leaderboard_auto_freeze(p_competition_id);
END;
$$;

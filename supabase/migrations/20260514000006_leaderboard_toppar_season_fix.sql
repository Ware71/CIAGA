-- ============================================================
-- Leaderboard: add to_par/course_par; fix season standings filter;
-- backfill standalone competitions without standings_contribution.
-- ============================================================

-- ── 1. Add to_par and course_par columns ────────────────────
ALTER TABLE public.competition_leaderboard_entries
  ADD COLUMN IF NOT EXISTS to_par     integer,
  ADD COLUMN IF NOT EXISTS course_par integer;

-- ── 2. Update ciaga_compute_competition_leaderboard ─────────
-- Based on latest version (20260514000003) plus:
--   • computes course_par from round_tee_snapshots via round_participants.tee_snapshot_id
--   • derives to_par = net_score - course_par
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
  v_points_model   text;
  v_points_table   jsonb;
BEGIN
  SELECT
    scoring_model::text,
    num_rounds,
    group_id,
    season_id,
    standings_contribution,
    points_model::text,
    points_table
  INTO
    v_scoring_model, v_num_rounds, v_group_id, v_season_id, v_contribution,
    v_points_model, v_points_table
  FROM competitions
  WHERE id = p_competition_id;

  v_higher_better := (v_scoring_model = 'stableford_points');
  v_num_rounds    := COALESCE(v_num_rounds, 1);
  v_points_table  := COALESCE(v_points_table, '{}'::jsonb);

  DELETE FROM competition_leaderboard_entries
  WHERE competition_id = p_competition_id;

  INSERT INTO competition_leaderboard_entries
    (competition_id, profile_id, gross_score, net_score, format_points,
     points_earned,
     rounds_submitted, last_submission_at, is_live, holes_completed,
     course_par, to_par,
     position, computed_at)
  SELECT
    p_competition_id,
    agg.profile_id,
    agg.gross_score,
    agg.net_score,
    NULL AS format_points,
    CASE
      WHEN v_points_model = 'none' OR agg.position IS NULL THEN NULL
      WHEN v_points_model = 'fedex_style' THEN
        (ARRAY[500,300,190,140,110,90,75,60,48,38,30,24,18,14,10,8,6,4,2,1])[LEAST(agg.position, 20)]
      WHEN v_points_model IN ('position_based', 'custom_table') THEN
        CASE
          WHEN v_points_table ->> agg.position::text IS NOT NULL
            THEN (v_points_table ->> agg.position::text)::numeric
          ELSE 0
        END
      ELSE NULL
    END AS points_earned,
    agg.rounds_submitted,
    agg.last_submission_at,
    agg.is_live,
    agg.holes_completed,
    agg.course_par,
    CASE WHEN agg.net_score IS NOT NULL AND agg.course_par IS NOT NULL
      THEN agg.net_score - agg.course_par
      ELSE NULL
    END AS to_par,
    -- Use RANK() so tied players share the same position and earn equal points
    CASE
      WHEN agg.net_score IS NULL THEN NULL
      ELSE RANK() OVER (
        ORDER BY
          CASE WHEN NOT v_higher_better THEN agg.net_score END ASC NULLS LAST,
          CASE WHEN v_higher_better     THEN agg.net_score END DESC NULLS LAST,
          agg.holes_completed DESC,
          agg.last_submission_at ASC NULLS LAST
      )
    END::integer AS position,
    NOW() AS computed_at
  FROM (
    WITH
    -- Accepted/submitted rounds per player
    submitted AS (
      SELECT
        s.profile_id,
        SUM(hrr.adjusted_gross_score)::integer                                         AS submitted_gross,
        SUM(COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))::integer   AS submitted_hcp,
        SUM(CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END)::integer                       AS submitted_holes,
        -- Scale par by holes played within each submission (handles 9-hole rounds correctly)
        SUM(
          CASE WHEN hrr.is_9_hole
            THEN (COALESCE(rts.par_total, 72) * 9 / COALESCE(rts.holes_count, 18))
            ELSE COALESCE(rts.par_total, 72)
          END
        )::integer                                                                      AS submitted_par,
        COUNT(*)::integer                                                               AS rounds_submitted,
        MAX(s.submitted_at)                                                             AS last_submission_at
      FROM competition_round_submissions s
      JOIN round_participants rp
        ON rp.round_id = s.round_id AND rp.profile_id = s.profile_id
      JOIN handicap_round_results hrr
        ON hrr.participant_id = rp.id
      LEFT JOIN round_tee_snapshots rts
        ON rts.id = rp.tee_snapshot_id
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
        COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)          AS course_hcp,
        -- Pro-rate par for holes played so far
        CASE WHEN COALESCE(scores.hole_count, 0) > 0 AND rts.par_total IS NOT NULL
          THEN ROUND(
            rts.par_total::numeric
            * COALESCE(scores.hole_count, 0)
            / COALESCE(rts.holes_count, 18)
          )::integer
          ELSE NULL
        END                                                                       AS live_par
      FROM competition_tee_times ctt
      JOIN rounds r
        ON r.competition_tee_time_id = ctt.id
        AND r.status = 'live'
      JOIN round_participants rp
        ON rp.round_id = r.id
      LEFT JOIN round_tee_snapshots rts
        ON rts.id = rp.tee_snapshot_id
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
        AND rp.profile_id NOT IN (
          SELECT s2.profile_id
          FROM competition_round_submissions s2
          WHERE s2.competition_id = p_competition_id
            AND s2.accepted = true
          GROUP BY s2.profile_id
          HAVING COUNT(*) >= v_num_rounds
        )
    ),

    -- All registered participants across all tee times (for full-field representation)
    all_registered AS (
      SELECT DISTINCT rp.profile_id
      FROM competition_tee_times ctt
      JOIN rounds r ON r.competition_tee_time_id = ctt.id
      JOIN round_participants rp ON rp.round_id = r.id
      WHERE ctt.competition_id = p_competition_id
    )

    SELECT
      COALESCE(sub.profile_id, live.profile_id, reg.profile_id)           AS profile_id,
      CASE
        WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
        THEN COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)
        ELSE NULL
      END                                                                   AS gross_score,
      CASE
        WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
        THEN COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)
             - COALESCE(sub.submitted_hcp, 0)
             - FLOOR(COALESCE(live.course_hcp, 0)
                 * COALESCE(live.live_holes, 0) / 18.0)::integer
        ELSE NULL
      END                                                                   AS net_score,
      COALESCE(sub.rounds_submitted, 0)                                    AS rounds_submitted,
      sub.last_submission_at,
      (live.profile_id IS NOT NULL AND COALESCE(live.live_holes, 0) > 0)  AS is_live,
      (COALESCE(sub.submitted_holes, 0) + COALESCE(live.live_holes, 0))   AS holes_completed,
      -- course_par: sum of par for holes actually played (submitted + live in-progress)
      CASE
        WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
        THEN COALESCE(sub.submitted_par, 0) + COALESCE(live.live_par, 0)
        ELSE NULL
      END                                                                   AS course_par
    FROM all_registered reg
    LEFT JOIN submitted sub ON sub.profile_id = reg.profile_id
    LEFT JOIN live_rounds live ON live.profile_id = reg.profile_id
  ) agg;

  -- Cascade to group standings
  IF v_group_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_group_standings(v_group_id);
  END IF;

  -- Cascade to season standings
  IF v_season_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_season_standings(v_season_id);
  END IF;
END;
$$;

-- ── 3. Fix ciaga_compute_season_standings ───────────────────
-- Remove the AND agg.points_earned IS NOT NULL filter which excluded
-- all players from competitions with points_model = 'none'.
-- Use AND agg.net_score IS NOT NULL instead (player has actually scored).
CREATE OR REPLACE FUNCTION public.ciaga_compute_season_standings(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_standings_model text;
BEGIN
  SELECT standings_model::text INTO v_standings_model
  FROM series_seasons
  WHERE id = p_season_id;

  DELETE FROM season_standings_entries
  WHERE season_id = p_season_id;

  INSERT INTO season_standings_entries
    (season_id, profile_id, season_points, events_played, wins, top_3s, best_finish, position, last_computed_at)
  SELECT
    p_season_id,
    agg.profile_id,
    COALESCE(SUM(agg.points_earned), 0)                          AS season_points,
    COUNT(DISTINCT agg.competition_id)::integer                  AS events_played,
    COUNT(*) FILTER (WHERE agg.position = 1)::integer            AS wins,
    COUNT(*) FILTER (WHERE agg.position <= 3)::integer           AS top_3s,
    MIN(agg.position)                                            AS best_finish,
    RANK() OVER (
      ORDER BY
        COALESCE(SUM(agg.points_earned), 0) DESC,
        COUNT(*) FILTER (WHERE agg.position = 1) DESC,
        COUNT(*) FILTER (WHERE agg.position <= 3) DESC,
        MIN(agg.position) ASC NULLS LAST
    )::integer AS position,
    NOW() AS last_computed_at
  FROM competition_leaderboard_entries agg
  JOIN competitions c ON c.id = agg.competition_id
  WHERE c.season_id = p_season_id
    AND c.standings_contribution IN ('season', 'both')
    AND c.majors_status IN ('live', 'completed', 'official')
    AND agg.net_score IS NOT NULL   -- player has actually scored (replaces points_earned IS NOT NULL)
  GROUP BY agg.profile_id;
END;
$$;

-- ── 4. Backfill standalone competitions with season_id ───────
-- Competitions created before the default was fixed (20260513000002)
-- may still have 'event_only'. Flip any that have a season_id set.
UPDATE public.competitions
SET standings_contribution = 'season'
WHERE season_id IS NOT NULL
  AND standings_contribution NOT IN ('season', 'both');

-- ── 5. Recompute all live/completed season standings ─────────
DO $$
DECLARE
  s_id uuid;
BEGIN
  FOR s_id IN
    SELECT DISTINCT c.season_id
    FROM public.competitions c
    WHERE c.season_id IS NOT NULL
      AND c.majors_status IN ('live', 'completed', 'official')
      AND c.standings_contribution IN ('season', 'both')
  LOOP
    PERFORM public.ciaga_compute_season_standings(s_id);
  END LOOP;
END;
$$;

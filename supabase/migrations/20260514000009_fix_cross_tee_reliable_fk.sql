-- ============================================================
-- Fix: all cross-tee leaderboard queries used rounds.competition_tee_time_id
-- (the back-link FK), which is set via a fire-and-forget UPDATE with no error
-- handling and may be NULL.  The reliable FK direction is
-- competition_tee_times.round_id, which is always set in the INSERT.
--
-- Changes:
--   1. ciaga_on_round_finished: look up competition via ctt.round_id = NEW.id
--      instead of checking NEW.competition_tee_time_id IS NOT NULL.
--   2. ciaga_compute_competition_leaderboard: change all_registered and
--      live_rounds CTEs to JOIN on r.id = ctt.round_id.
-- ============================================================

-- ── 1. Fix round-finished trigger ────────────────────────────
CREATE OR REPLACE FUNCTION public.ciaga_on_round_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_competition_id uuid;
BEGIN
  IF NEW.status = 'finished'
     AND (OLD.status IS DISTINCT FROM 'finished')
  THEN
    -- Use the reliable FK direction: ctt.round_id → round
    SELECT competition_id INTO v_competition_id
    FROM competition_tee_times
    WHERE round_id = NEW.id;

    IF v_competition_id IS NOT NULL THEN
      PERFORM ciaga_compute_competition_leaderboard(v_competition_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_round_finished_recompute ON public.rounds;
CREATE TRIGGER trg_round_finished_recompute
  AFTER UPDATE ON public.rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_round_finished();

-- ── 2. Fix leaderboard computation function ───────────────────
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
    ranked.profile_id,
    ranked.gross_score,
    ranked.net_score,
    NULL AS format_points,
    CASE
      WHEN v_points_model = 'none' OR ranked.position IS NULL THEN NULL
      WHEN v_points_model = 'fedex_style' THEN
        (ARRAY[500,300,190,140,110,90,75,60,48,38,30,24,18,14,10,8,6,4,2,1])[LEAST(ranked.position, 20)]
      WHEN v_points_model IN ('position_based', 'custom_table') THEN
        CASE
          WHEN v_points_table ->> ranked.position::text IS NOT NULL
            THEN (v_points_table ->> ranked.position::text)::numeric
          ELSE 0
        END
      ELSE NULL
    END AS points_earned,
    ranked.rounds_submitted,
    ranked.last_submission_at,
    ranked.is_live,
    ranked.holes_completed,
    ranked.course_par,
    ranked.to_par,
    ranked.position,
    NOW() AS computed_at
  FROM (
    SELECT
      agg.profile_id,
      agg.gross_score,
      agg.net_score,
      agg.rounds_submitted,
      agg.last_submission_at,
      agg.is_live,
      agg.holes_completed,
      agg.course_par,
      CASE WHEN agg.net_score IS NOT NULL AND agg.course_par IS NOT NULL
        THEN agg.net_score - agg.course_par
        ELSE NULL
      END AS to_par,
      CASE
        WHEN agg.net_score IS NULL THEN NULL
        ELSE RANK() OVER (
          ORDER BY
            CASE WHEN NOT v_higher_better THEN agg.net_score END ASC NULLS LAST,
            CASE WHEN v_higher_better     THEN agg.net_score END DESC NULLS LAST,
            agg.holes_completed DESC,
            agg.last_submission_at ASC NULLS LAST
        )
      END::integer AS position
    FROM (
      WITH
      submitted AS (
        SELECT
          s.profile_id,
          SUM(hrr.adjusted_gross_score)::integer                                         AS submitted_gross,
          SUM(COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))::integer   AS submitted_hcp,
          SUM(CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END)::integer                       AS submitted_holes,
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

      live_rounds AS (
        SELECT
          rp.profile_id,
          COALESCE(scores.total_strokes, 0)::integer                              AS live_gross,
          COALESCE(scores.hole_count, 0)::integer                                 AS live_holes,
          COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)          AS course_hcp,
          CASE WHEN COALESCE(scores.hole_count, 0) > 0 AND rts.par_total IS NOT NULL
            THEN ROUND(
              rts.par_total::numeric
              * COALESCE(scores.hole_count, 0)
              / COALESCE(rts.holes_count, 18)
            )::integer
            ELSE NULL
          END                                                                       AS live_par
        FROM competition_tee_times ctt
        -- Use reliable FK: ctt.round_id → rounds.id
        JOIN rounds r
          ON r.id = ctt.round_id
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

      -- All registered participants across all tee times
      all_registered AS (
        SELECT DISTINCT rp.profile_id
        FROM competition_tee_times ctt
        -- Use reliable FK: ctt.round_id → rounds.id
        JOIN rounds r ON r.id = ctt.round_id
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
        CASE
          WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
          THEN COALESCE(sub.submitted_par, 0) + COALESCE(live.live_par, 0)
          ELSE NULL
        END                                                                   AS course_par
      FROM all_registered reg
      LEFT JOIN submitted sub ON sub.profile_id = reg.profile_id
      LEFT JOIN live_rounds live ON live.profile_id = reg.profile_id
    ) agg
  ) ranked;

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

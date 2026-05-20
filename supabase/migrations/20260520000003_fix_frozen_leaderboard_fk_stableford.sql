-- ============================================================
-- Fix: two remaining live-leaderboard realtime bugs.
--
-- 1. ciaga_get_frozen_leaderboard: live_scores CTE used the
--    unreliable back-link FK (r.competition_tee_time_id = ctt.id)
--    which is NULL for rounds created by current API code.
--    Fix: use r.id = ctt.round_id (reliable direction), matching
--    every other live-round lookup in the system.
--
-- 2. ciaga_get_frozen_leaderboard: net_score was always computed
--    as gross - hcp (stroke play formula) for all scoring models.
--    For stableford_points competitions the frozen leaderboard
--    must rank by stableford points capped at p_threshold_hole,
--    not by net strokes. Each sub-CTE now carries a `pts` column
--    (per-hole stableford points up to the threshold); `combined`
--    uses SUM(pts) as net_score when v_higher_better is true.
--
-- 3. ciaga_compute_competition_leaderboard: live_rounds CTE
--    filtered r.status = 'live' only. Rounds that have active
--    scoring before an explicit round-start (status still
--    'scheduled') were silently excluded, producing 0 entries
--    and no realtime INSERT events.  Restores the original
--    IN ('scheduled', 'live') guard that was present before
--    migration 20260514000009 narrowed it.
-- ============================================================

-- ── 1 + 2: fix ciaga_get_frozen_leaderboard ─────────────────

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
  -- FIX: use r.id = ctt.round_id (reliable direction) instead of
  --      r.competition_tee_time_id = ctt.id (back-link, may be NULL).
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
    -- FIX: reliable FK direction
    JOIN rounds r
      ON r.id = ctt.round_id
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

-- ── 3: restore 'scheduled' in live_rounds status filter ──────
-- Identical to the function body in 20260520000001 except
-- live_rounds uses IN ('scheduled', 'live') instead of = 'live'.
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
    ranked.format_points,
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
    CASE
      WHEN ranked.net_score IS NOT NULL AND ranked.course_par IS NOT NULL
      THEN ranked.net_score - ranked.course_par
      ELSE NULL
    END AS to_par,
    ranked.position,
    NOW() AS computed_at
  FROM (
    SELECT
      agg.profile_id,
      agg.gross_score,
      agg.net_score,
      agg.format_points,
      agg.rounds_submitted,
      agg.last_submission_at,
      agg.is_live,
      agg.holes_completed,
      agg.course_par,
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
      -- ── Stableford: per-hole points from accepted submissions ─────
      stab_pts AS (
        SELECT
          s.profile_id,
          SUM(hole_pts.pts)::integer AS stableford_total,
          COUNT(*)::integer          AS rounds_submitted,
          MAX(s.submitted_at)        AS last_submission_at
        FROM competition_round_submissions s
        JOIN round_participants rp
          ON rp.round_id = s.round_id AND rp.profile_id = s.profile_id
        CROSS JOIN LATERAL (
          VALUES (COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))
        ) AS hv(hcp)
        CROSS JOIN LATERAL (
          VALUES (FLOOR(hv.hcp::numeric / 18)::integer)
        ) AS hb(base)
        CROSS JOIN LATERAL (
          VALUES (hv.hcp - hb.base * 18)
        ) AS hr(rem)
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(GREATEST(0, 2 - (
            ls.strokes
            - hb.base
            - CASE WHEN rhs.stroke_index <= hr.rem THEN 1 ELSE 0 END
            - rhs.par
          ))), 0) AS pts
          FROM (
            SELECT DISTINCT ON (rse.hole_number)
              rse.hole_number,
              rse.strokes
            FROM round_score_events rse
            WHERE rse.round_id = s.round_id
              AND rse.participant_id = rp.id
            ORDER BY rse.hole_number, rse.created_at DESC
          ) ls
          JOIN round_tee_snapshots rts2
            ON rts2.id = rp.tee_snapshot_id
          JOIN round_hole_snapshots rhs
            ON rhs.round_tee_snapshot_id = rts2.id
           AND rhs.hole_number = ls.hole_number
        ) hole_pts ON true
        WHERE s.competition_id = p_competition_id
          AND s.accepted = true
          AND v_scoring_model = 'stableford_points'
        GROUP BY s.profile_id
      ),

      -- ── Stroke play: standard submitted totals ────────────────────
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

      -- ── In-progress (live) rounds via competition tee times ───────
      -- FIX: include 'scheduled' alongside 'live' so rounds being
      -- scored before an explicit round-start are not silently dropped.
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
          END                                                                       AS live_par,
          COALESCE(stab_pts_lat.pts, 0)::integer                                   AS live_stab_total
        FROM competition_tee_times ctt
        JOIN rounds r
          ON r.id = COALESCE(
               ctt.round_id,
               (SELECT r2.id FROM rounds r2
                WHERE r2.competition_tee_time_id = ctt.id
                LIMIT 1)
             )
          -- FIX: include 'scheduled' so rounds not yet explicitly started are found
          AND r.status IN ('scheduled', 'live')
        JOIN round_participants rp
          ON rp.round_id = r.id
          AND rp.is_guest = false
          AND rp.profile_id IS NOT NULL
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
        CROSS JOIN LATERAL (
          VALUES (COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))
        ) AS hv(hcp)
        CROSS JOIN LATERAL (
          VALUES (FLOOR(hv.hcp::numeric / 18)::integer)
        ) AS hb(base)
        CROSS JOIN LATERAL (
          VALUES (hv.hcp - hb.base * 18)
        ) AS hr(rem)
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(GREATEST(0, 2 - (
            ls.strokes
            - hb.base
            - CASE WHEN rhs.stroke_index <= hr.rem THEN 1 ELSE 0 END
            - rhs.par
          ))), 0) AS pts
          FROM (
            SELECT DISTINCT ON (rse.hole_number)
              rse.hole_number,
              rse.strokes
            FROM round_score_events rse
            WHERE rse.round_id = r.id
              AND rse.participant_id = rp.id
            ORDER BY rse.hole_number, rse.created_at DESC
          ) ls
          JOIN round_hole_snapshots rhs
            ON rhs.round_tee_snapshot_id = rts.id
           AND rhs.hole_number = ls.hole_number
          WHERE v_scoring_model = 'stableford_points'
        ) stab_pts_lat ON true
        WHERE ctt.competition_id = p_competition_id
          AND rp.profile_id NOT IN (
            SELECT s2.profile_id
            FROM competition_round_submissions s2
            WHERE s2.competition_id = p_competition_id
              AND s2.accepted = true
            GROUP BY s2.profile_id
            HAVING COUNT(*) >= v_num_rounds
          )
      )

      -- ── Final aggregation ─────────────────────────────────────────
      SELECT
        COALESCE(stab.profile_id, sub.profile_id, live.profile_id)   AS profile_id,

        CASE
          WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
          THEN COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)
          ELSE NULL
        END                                                           AS gross_score,

        CASE
          WHEN v_scoring_model = 'stableford_points' THEN
            CASE
              WHEN stab.profile_id IS NOT NULL OR live.profile_id IS NOT NULL THEN
                COALESCE(stab.stableford_total, 0) + COALESCE(live.live_stab_total, 0)
              ELSE NULL
            END
          ELSE
            CASE
              WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
              THEN COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)
                   - COALESCE(sub.submitted_hcp, 0)
                   - FLOOR(COALESCE(live.course_hcp, 0)
                       * COALESCE(live.live_holes, 0) / 18.0)::integer
              ELSE NULL
            END
        END                                                           AS net_score,

        CASE
          WHEN v_scoring_model = 'stableford_points'
               AND (stab.profile_id IS NOT NULL OR live.profile_id IS NOT NULL)
          THEN (COALESCE(stab.stableford_total, 0) + COALESCE(live.live_stab_total, 0))::numeric
          ELSE NULL
        END                                                           AS format_points,

        COALESCE(stab.rounds_submitted, sub.rounds_submitted, 0)     AS rounds_submitted,
        COALESCE(stab.last_submission_at, sub.last_submission_at)    AS last_submission_at,
        (live.profile_id IS NOT NULL AND COALESCE(live.live_holes, 0) > 0)  AS is_live,
        (COALESCE(sub.submitted_holes, 0) + COALESCE(live.live_holes, 0))   AS holes_completed,

        CASE
          WHEN v_scoring_model = 'stableford_points' THEN NULL
          WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
          THEN COALESCE(sub.submitted_par, 0) + COALESCE(live.live_par, 0)
          ELSE NULL
        END                                                           AS course_par

      FROM stab_pts stab
      FULL OUTER JOIN submitted sub   ON sub.profile_id  = stab.profile_id
      FULL OUTER JOIN live_rounds live
        ON live.profile_id = COALESCE(stab.profile_id, sub.profile_id)

      WHERE COALESCE(stab.rounds_submitted, sub.rounds_submitted, 0) > 0
         OR COALESCE(live.live_holes, 0) > 0

    ) agg
  ) ranked;

  IF v_group_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_group_standings(v_group_id);
  END IF;

  IF v_season_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_season_standings(v_season_id);
  END IF;

  PERFORM ciaga_check_leaderboard_auto_freeze(p_competition_id);
END;
$$;

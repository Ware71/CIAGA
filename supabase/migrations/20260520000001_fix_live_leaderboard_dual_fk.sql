-- ============================================================
-- Fix: live leaderboard not showing for rounds where
-- competition_tee_times.round_id is NULL.
--
-- Root cause: migration 20260519000009 backfilled ctt.round_id
-- from the rounds.competition_tee_time_id back-link. But any
-- tee time created by old code AFTER migration 9 ran (or where
-- the back-link itself is NULL) still has ctt.round_id = NULL.
--
-- The live_rounds CTE in ciaga_compute_competition_leaderboard
-- and ciaga_on_score_event_inserted both rely exclusively on
-- ctt.round_id (the reliable direction) and silently skip
-- rounds where it is NULL.
--
-- Fixes:
--   1. Re-run the ctt.round_id backfill (idempotent for rows
--      already fixed; catches any remaining NULL cases).
--   2. Update ciaga_on_score_event_inserted to try both FK
--      directions (ctt.round_id first, back-link as fallback).
--   3. Update ciaga_compute_competition_leaderboard so the
--      live_rounds CTE uses COALESCE(ctt.round_id, back-link)
--      to find the round regardless of which direction is set.
--   4. Recompute leaderboards for all stableford competitions
--      so any currently-live rounds appear immediately.
-- ============================================================

-- 1. Backfill ctt.round_id for any rows still NULL (idempotent).
UPDATE competition_tee_times ctt
SET round_id = r.id
FROM rounds r
WHERE r.competition_tee_time_id = ctt.id
  AND ctt.round_id IS NULL;

-- 2. Trigger function: find competition via either FK direction.
CREATE OR REPLACE FUNCTION public.ciaga_on_score_event_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_competition_id uuid;
BEGIN
  -- Primary: reliable FK direction (ctt.round_id → rounds.id).
  SELECT ctt.competition_id INTO v_competition_id
  FROM competition_tee_times ctt
  WHERE ctt.round_id = NEW.round_id;

  -- Fallback: back-link direction for rounds created by old code
  -- where ctt.round_id was not set.
  IF v_competition_id IS NULL THEN
    SELECT ctt.competition_id INTO v_competition_id
    FROM competition_tee_times ctt
    JOIN rounds r ON r.competition_tee_time_id = ctt.id
    WHERE r.id = NEW.round_id;
  END IF;

  IF v_competition_id IS NOT NULL THEN
    PERFORM ciaga_compute_competition_leaderboard(v_competition_id);
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Leaderboard compute function: live_rounds CTE uses both FK
--    directions via COALESCE so rounds with ctt.round_id = NULL
--    are still found via the back-link.
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
      -- Only populated when v_scoring_model = 'stableford_points'.
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
      -- Uses COALESCE(ctt.round_id, back-link) so rounds where
      -- ctt.round_id was not set by older API code are still found.
      -- Only non-guest participants with profile_id are included.
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
          AND r.status = 'live'
        JOIN round_participants rp
          ON rp.round_id = r.id
          AND rp.is_guest = false
          AND rp.profile_id IS NOT NULL
        LEFT JOIN round_tee_snapshots rts
          ON rts.id = rp.tee_snapshot_id
        -- Total strokes + hole count for stroke play / display
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
        -- Handicap variables for live stableford calculation
        CROSS JOIN LATERAL (
          VALUES (COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0))
        ) AS hv(hcp)
        CROSS JOIN LATERAL (
          VALUES (FLOOR(hv.hcp::numeric / 18)::integer)
        ) AS hb(base)
        CROSS JOIN LATERAL (
          VALUES (hv.hcp - hb.base * 18)
        ) AS hr(rem)
        -- Per-hole stableford points for the live round
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

        -- gross_score always in strokes
        CASE
          WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
          THEN COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)
          ELSE NULL
        END                                                           AS gross_score,

        -- net_score:
        --   stableford → submitted points + live points (ranks DESC, v_higher_better = true)
        --   stroke play → net strokes (ranks ASC)
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

        -- format_points: stableford pts for display (submitted + live)
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

        -- course_par: NULL for stableford; pro-rated for stroke play
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

  -- Cascade to group standings
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

-- 4. Recompute leaderboards for all stableford competitions so any
--    currently-live rounds appear without waiting for the next score event.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM competitions WHERE competition_type = 'stableford'
  LOOP
    PERFORM ciaga_compute_competition_leaderboard(v_id);
  END LOOP;
END;
$$;

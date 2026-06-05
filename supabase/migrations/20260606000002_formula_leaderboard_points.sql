-- Extend ciaga_compute_event_leaderboard to support ciaga_formula and
-- custom_formula points models.
--
-- Both models use the same formula structure:
--   Points = ROUND(
--     base
--     + round_factor × scale × ((F−P)/(F−1))^compression × (F/6)^field_sensitivity
--     + { win_bonus_scale × (F/6)^field_sensitivity  if P = 1 }
--   )
-- where:
--   F = field size (points_config.num_participants override, or count of finishers)
--   P = finishing position (1 = best)
--   round_factor = 1 + round_coefficient × (min(R,3) − 1)
--   R = events.num_rounds (already fetched as v_num_rounds)
--
-- CIAGA defaults: base=18, scale=32, compression=0.7,
--                 field_sensitivity=0.2, win_bonus_scale=5, round_coefficient=0.2
-- Custom formula: all defaults overridable via points_config jsonb.

CREATE OR REPLACE FUNCTION public.ciaga_compute_event_leaderboard(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scoring_model     text;
  v_num_rounds        integer;
  v_group_id          uuid;
  v_season_id         uuid;
  v_contribution      text;
  v_points_model      text;
  v_points_table      jsonb;
  -- formula model variables
  v_points_config     jsonb;
  v_field_size        integer;
  v_base_pts          numeric;
  v_scale_pts         numeric;
  v_compression       numeric;
  v_field_sensitivity numeric;
  v_win_bonus_scale   numeric;
  v_round_coeff       numeric;
  v_round_factor      numeric;
  v_field_scale       numeric;
BEGIN
  SELECT
    scoring_model::text,
    num_rounds,
    group_id,
    season_id,
    standings_contribution,
    points_model::text,
    points_table,
    points_config
  INTO
    v_scoring_model, v_num_rounds, v_group_id, v_season_id, v_contribution,
    v_points_model, v_points_table, v_points_config
  FROM events
  WHERE id = p_event_id;

  v_num_rounds   := COALESCE(v_num_rounds, 1);
  v_points_table := COALESCE(v_points_table, '{}'::jsonb);
  v_points_config := COALESCE(v_points_config, '{}'::jsonb);

  -- Pre-compute formula variables so they are available as scalars in the
  -- per-row CASE expression below.
  IF v_points_model IN ('ciaga_formula', 'custom_formula') THEN
    v_base_pts          := COALESCE((v_points_config->>'base')::numeric,              18);
    v_scale_pts         := COALESCE((v_points_config->>'scale')::numeric,             32);
    v_compression       := COALESCE((v_points_config->>'compression')::numeric,        0.7);
    v_field_sensitivity := COALESCE((v_points_config->>'field_sensitivity')::numeric,  0.2);
    v_win_bonus_scale   := COALESCE((v_points_config->>'win_bonus_scale')::numeric,    5);
    v_round_coeff       := COALESCE((v_points_config->>'round_coefficient')::numeric,  0.2);
    v_round_factor      := 1.0 + v_round_coeff * (LEAST(v_num_rounds, 3) - 1);

    -- F: use stored override when present, else count actual finishers.
    IF (v_points_config->>'num_participants') IS NOT NULL THEN
      v_field_size := (v_points_config->>'num_participants')::integer;
    ELSE
      SELECT COUNT(*) INTO v_field_size
      FROM (
        SELECT s.profile_id
        FROM event_round_submissions s
        WHERE s.event_id = p_event_id AND s.accepted = true
        GROUP BY s.profile_id
        HAVING COUNT(*) >= v_num_rounds
      ) completed_players;
      v_field_size := GREATEST(COALESCE(v_field_size, 1), 1);
    END IF;

    v_field_scale := POWER(GREATEST(v_field_size, 1)::numeric / 6.0, v_field_sensitivity);
  END IF;

  DELETE FROM event_leaderboard_entries
  WHERE event_id = p_event_id;

  INSERT INTO event_leaderboard_entries
    (event_id, profile_id, gross_score, net_score, format_points,
     points_earned,
     rounds_submitted, last_submission_at, is_live, holes_completed,
     course_par, to_par,
     position, computed_at)
  SELECT
    p_event_id,
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
      WHEN v_points_model IN ('ciaga_formula', 'custom_formula') THEN
        ROUND((
          v_base_pts
          + v_round_factor
            * v_scale_pts
            * POWER(
                CASE WHEN v_field_size > 1
                  THEN GREATEST(v_field_size - ranked.position, 0)::numeric / (v_field_size - 1)
                  ELSE 0 END,
                v_compression)
            * v_field_scale
          + CASE WHEN ranked.position = 1
              THEN v_win_bonus_scale * v_field_scale
              ELSE 0
            END
        )::numeric, 0)
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
            agg.net_score ASC NULLS LAST,
            agg.holes_completed DESC,
            agg.last_submission_at ASC NULLS LAST
        )
      END::integer AS position
    FROM (
      WITH
      stab_pts AS (
        SELECT
          s.profile_id,
          SUM(hole_pts.pts)::integer        AS stableford_total,
          SUM(hole_pts.gross)::integer      AS gross_total,
          SUM(hole_pts.par_sum)::integer    AS course_par_total,
          SUM(hole_pts.hole_count)::integer AS total_holes,
          COUNT(*)::integer                 AS rounds_submitted,
          MAX(s.submitted_at)               AS last_submission_at
        FROM event_round_submissions s
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
          SELECT
            COALESCE(SUM(GREATEST(0, 2 - (
              ls.strokes
              - hb.base
              - CASE WHEN rhs.stroke_index <= hr.rem THEN 1 ELSE 0 END
              - rhs.par
            ))), 0)::integer            AS pts,
            COALESCE(SUM(ls.strokes), 0)::integer AS gross,
            COALESCE(SUM(rhs.par), 0)::integer    AS par_sum,
            COUNT(*)::integer                      AS hole_count
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
        WHERE s.event_id = p_event_id
          AND s.accepted = true
          AND v_scoring_model = 'stableford_points'
        GROUP BY s.profile_id
      ),

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
        FROM event_round_submissions s
        JOIN round_participants rp
          ON rp.round_id = s.round_id AND rp.profile_id = s.profile_id
        JOIN handicap_round_results hrr
          ON hrr.participant_id = rp.id
        LEFT JOIN round_tee_snapshots rts
          ON rts.id = rp.tee_snapshot_id
        WHERE s.event_id = p_event_id
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
          END                                                                       AS live_par,
          COALESCE(stab_pts_lat.pts, 0)::integer                                   AS live_stab_total,
          COALESCE(stab_pts_lat.par_exact, 0)::integer                             AS live_par_exact
        FROM event_tee_times ctt
        JOIN rounds r
          ON r.event_tee_time_id = ctt.id
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
          SELECT
            COALESCE(SUM(GREATEST(0, 2 - (
              ls.strokes
              - hb.base
              - CASE WHEN rhs.stroke_index <= hr.rem THEN 1 ELSE 0 END
              - rhs.par
            ))), 0)       AS pts,
            SUM(rhs.par)  AS par_exact
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
        WHERE ctt.event_id = p_event_id
          AND rp.profile_id NOT IN (
            SELECT s2.profile_id
            FROM event_round_submissions s2
            WHERE s2.event_id = p_event_id
              AND s2.accepted = true
            GROUP BY s2.profile_id
            HAVING COUNT(*) >= v_num_rounds
          )
      )

      SELECT
        COALESCE(stab.profile_id, sub.profile_id, live.profile_id)   AS profile_id,

        CASE
          WHEN v_scoring_model = 'stableford_points' THEN
            CASE
              WHEN stab.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
              THEN COALESCE(stab.gross_total, 0) + COALESCE(live.live_gross, 0)
              ELSE NULL
            END
          ELSE
            CASE
              WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
              THEN COALESCE(sub.submitted_gross, 0) + COALESCE(live.live_gross, 0)
              ELSE NULL
            END
        END                                                           AS gross_score,

        CASE
          WHEN v_scoring_model = 'stableford_points' THEN
            CASE
              WHEN stab.profile_id IS NOT NULL OR live.profile_id IS NOT NULL THEN
                (COALESCE(stab.course_par_total, 0) + COALESCE(live.live_par_exact, 0))
                + 2 * (COALESCE(stab.total_holes, 0) + COALESCE(live.live_holes, 0))
                - (COALESCE(stab.stableford_total, 0) + COALESCE(live.live_stab_total, 0))
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
        (COALESCE(stab.total_holes, sub.submitted_holes, 0) + COALESCE(live.live_holes, 0)) AS holes_completed,

        CASE
          WHEN v_scoring_model = 'stableford_points' THEN
            CASE
              WHEN stab.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
              THEN COALESCE(stab.course_par_total, 0) + COALESCE(live.live_par_exact, 0)
              ELSE NULL
            END
          ELSE
            CASE
              WHEN sub.profile_id IS NOT NULL OR live.profile_id IS NOT NULL
              THEN COALESCE(sub.submitted_par, 0) + COALESCE(live.live_par, 0)
              ELSE NULL
            END
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

  PERFORM ciaga_check_leaderboard_auto_freeze(p_event_id);
END;
$$;

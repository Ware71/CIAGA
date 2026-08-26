-- ============================================================
-- Multi-round: order a player's rounds by round_number, not submitted_at.
--
-- ciaga_get_frozen_leaderboard builds each round's hole range from
-- (round_num - 1) * 18, where round_num came from
-- ROW_NUMBER() ... ORDER BY submitted_at. Wall-clock order is not round order:
-- an admin re-accepting round 1 after round 2 was submitted swapped the two,
-- so the freeze clip landed on the wrong round.
--
-- Only the ranked_subs CTE changes; everything else is carried over verbatim
-- from 20260729000001. CREATE OR REPLACE (not DROP) so EXECUTE grants survive.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ciaga_get_frozen_leaderboard(
  p_event_id      uuid,
  p_threshold_hole integer
)
RETURNS TABLE(
  profile_id              uuid,
  gross_score             integer,
  net_score               integer,
  holes_shown             integer,
  actual_holes_completed  integer,
  is_live                 boolean,
  leaderboard_pos         integer,
  to_par                  integer,
  format_points           numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scoring_model text;
  v_num_rounds    integer;
BEGIN
  SELECT scoring_model::text, COALESCE(num_rounds, 1)
    INTO v_scoring_model, v_num_rounds
  FROM events WHERE id = p_event_id;

  RETURN QUERY
  WITH

  ranked_subs AS (
    -- Round order comes from event_rounds.round_number, NOT submitted_at.
    -- Ordering by wall-clock meant any backfill or admin re-accept could swap
    -- R1 and R2, which then shifts every hole range below. event_round_id is
    -- backfilled by 20260825000000; rows it could not resolve keep the old
    -- submitted_at ordering as a last resort.
    SELECT
      s.profile_id,
      s.round_id,
      ROW_NUMBER() OVER (
        PARTITION BY s.profile_id
        ORDER BY er.round_number NULLS LAST, s.submitted_at
      ) AS round_num
    FROM event_round_submissions s
    LEFT JOIN event_rounds er ON er.id = s.event_round_id
    WHERE s.event_id = p_event_id AND s.accepted = true
  ),

  sub_details AS (
    SELECT
      rs.profile_id,
      rs.round_num,
      rs.round_id,
      -- Cumulative hole ranges from the rounds actually played, not round_num
      -- * 18. A 9-hole leg inside a multi-round event used to shift every
      -- later round's range by 9 and clip the freeze on the wrong hole.
      COALESCE(
        SUM(CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END) OVER (
          PARTITION BY rs.profile_id ORDER BY rs.round_num
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)                                               AS range_start,
      SUM(CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END) OVER (
        PARTITION BY rs.profile_id ORDER BY rs.round_num
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )                                                     AS range_end,
      -- Actual gross (latest score event per hole); the WHS adjusted gross is
      -- for handicapping only. Fallback covers submissions with no hole data.
      COALESCE(raw.gross, hrr.adjusted_gross_score)         AS full_gross,
      COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0) AS full_hcp
    FROM ranked_subs rs
    JOIN round_participants rp
      ON rp.round_id = rs.round_id AND rp.profile_id = rs.profile_id
    JOIN handicap_round_results hrr
      ON hrr.participant_id = rp.id
    LEFT JOIN LATERAL (
      -- Picked-up holes score NDB; not-started holes on a finished card
      -- do too (WHS Rule 3.1). NULLIF preserves the adjusted-gross
      -- fallback for submissions with no hole-level data.
      SELECT NULLIF(SUM(
        COALESCE(es.effective_strokes, es.ndb_strokes)
      ), 0)::integer AS gross
      FROM round_effective_scores es
      WHERE es.round_id = rs.round_id
        AND es.participant_id = rp.id
    ) raw ON true
  ),

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

  -- Full rounds: all holes within threshold.
  full_scores AS (
    SELECT
      pr.profile_id,
      SUM(pr.full_gross)::integer                    AS gross,
      SUM(pr.full_hcp)::integer                      AS hcp,
      SUM(pr.range_end - pr.range_start)::integer    AS holes,
      SUM(pr.range_end - pr.range_start)::integer    AS actual_holes,
      COALESCE(SUM(stab.pts), 0)::integer            AS pts,
      SUM(
        CASE
          WHEN rts.par_total IS NOT NULL
          THEN ROUND(rts.par_total::numeric
                     * (pr.range_end - pr.range_start)
                     / COALESCE(rts.holes_count, 18))::integer
          ELSE NULL
        END
      )::integer                                     AS par,
      COALESCE(SUM(stab.par_sum), 0)::integer        AS stab_par
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
        COALESCE(SUM(GREATEST(0, 2 - (
          es.effective_strokes
          - hb.base
          - CASE WHEN es.stroke_index <= hr.rem THEN 1 ELSE 0 END
          - es.par
        ))), 0)         AS pts,
        SUM(es.par)     AS par_sum
      FROM round_effective_scores es
      WHERE es.round_id = pr.round_id
        AND es.participant_id = rp.id
        AND es.counts_as_played
        AND es.par IS NOT NULL
        AND v_scoring_model = 'stableford_points'
    ) stab ON true
    WHERE pr.inclusion = 'full'
    GROUP BY pr.profile_id
  ),

  -- Partial round: sum hole scores up to threshold.
  partial_scores AS (
    SELECT
      pr.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(pr.full_hcp * COALESCE(scores.hole_count, 0) / 18.0)::integer       AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                    AS holes,
      (pr.range_end - pr.range_start)::integer                                   AS actual_holes,
      COALESCE(stab.pts, 0)::integer                                             AS pts,
      CASE
        WHEN rts.par_total IS NOT NULL AND COALESCE(scores.hole_count, 0) > 0
        THEN ROUND(rts.par_total::numeric
                   * COALESCE(scores.hole_count, 0)
                   / COALESCE(rts.holes_count, 18))::integer
        ELSE NULL
      END                                                                        AS par,
      COALESCE(stab.par_sum, 0)::integer                                         AS stab_par
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
        SUM(es.effective_strokes) AS strokes,
        COUNT(*)                  AS hole_count
      FROM round_effective_scores es
      WHERE es.round_id = pr.round_id
        AND es.participant_id = rp.id
        AND es.hole_number <= (p_threshold_hole - pr.range_start)
        AND es.counts_as_played
    ) scores ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(GREATEST(0, 2 - (
          es.effective_strokes
          - hb.base
          - CASE WHEN es.stroke_index <= hr.rem THEN 1 ELSE 0 END
          - es.par
        ))), 0)         AS pts,
        SUM(es.par)     AS par_sum
      FROM round_effective_scores es
      WHERE es.round_id = pr.round_id
        AND es.participant_id = rp.id
        AND es.hole_number <= (p_threshold_hole - pr.range_start)
        AND es.counts_as_played
        AND es.par IS NOT NULL
        AND v_scoring_model = 'stableford_points'
    ) stab ON true
    WHERE pr.inclusion = 'partial'
  ),

  -- In-progress players: score through threshold hole.
  live_scores AS (
    SELECT
      rp.profile_id,
      COALESCE(scores.strokes, 0)::integer                                      AS gross,
      FLOOR(COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)
            * COALESCE(scores.hole_count, 0) / 18.0)::integer                  AS hcp,
      COALESCE(scores.hole_count, 0)::integer                                   AS holes,
      COALESCE(uncapped.hole_count, 0)::integer                                 AS actual_holes,
      COALESCE(stab.pts, 0)::integer                                            AS pts,
      CASE
        WHEN rts.par_total IS NOT NULL AND COALESCE(scores.hole_count, 0) > 0
        THEN ROUND(rts.par_total::numeric
                   * COALESCE(scores.hole_count, 0)
                   / COALESCE(rts.holes_count, 18))::integer
        ELSE NULL
      END                                                                       AS par,
      COALESCE(stab.par_sum, 0)::integer                                        AS stab_par
    FROM event_tee_times ctt
    JOIN rounds r
      ON r.id = COALESCE(
           ctt.round_id,
           (SELECT r2.id FROM rounds r2
            WHERE r2.event_tee_time_id = ctt.id
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
    JOIN LATERAL (
      -- How many holes this player has already banked in earlier rounds, so
      -- the live round's within-round hole numbers can be offset onto the
      -- event-wide scale. Sums the rounds actually played rather than
      -- assuming 18 apiece.
      SELECT COALESCE(SUM(CASE WHEN hrr3.is_9_hole THEN 9 ELSE 18 END), 0)::integer AS range_start
      FROM event_round_submissions s3
      JOIN round_participants rp3
        ON rp3.round_id = s3.round_id AND rp3.profile_id = s3.profile_id
      JOIN handicap_round_results hrr3
        ON hrr3.participant_id = rp3.id
      WHERE s3.event_id = p_event_id
        AND s3.profile_id = rp.profile_id
        AND s3.accepted = true
    ) live_offset ON true
    LEFT JOIN LATERAL (
      SELECT
        SUM(es.effective_strokes) AS strokes,
        COUNT(*)                  AS hole_count
      FROM round_effective_scores es
      WHERE es.round_id = r.id
        AND es.participant_id = rp.id
        AND es.hole_number <= (p_threshold_hole - live_offset.range_start)
        AND es.counts_as_played
    ) scores ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS hole_count
      FROM round_effective_scores es
      WHERE es.round_id = r.id
        AND es.participant_id = rp.id
        AND es.counts_as_played
    ) uncapped ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(GREATEST(0, 2 - (
          es.effective_strokes
          - hb.base
          - CASE WHEN es.stroke_index <= hr.rem THEN 1 ELSE 0 END
          - es.par
        ))), 0)         AS pts,
        SUM(es.par)     AS par_sum
      FROM round_effective_scores es
      WHERE es.round_id = r.id
        AND es.participant_id = rp.id
        AND es.hole_number <= (p_threshold_hole - live_offset.range_start)
        AND es.counts_as_played
        AND es.par IS NOT NULL
        AND v_scoring_model = 'stableford_points'
    ) stab ON true
    WHERE ctt.event_id = p_event_id
      AND rp.profile_id NOT IN (
        SELECT s2.profile_id
        FROM event_round_submissions s2
        WHERE s2.event_id = p_event_id AND s2.accepted = true
        GROUP BY s2.profile_id
        HAVING COUNT(*) >= v_num_rounds
      )
  ),

  combined AS (
    SELECT
      pid,
      SUM(gross)::integer                                             AS gross_score,
      CASE
        WHEN v_scoring_model = 'stableford_points' THEN
          (SUM(stab_par) + 2 * SUM(holes) - SUM(pts))::integer
        ELSE
          SUM(gross - hcp)::integer
      END                                                             AS net_score,
      SUM(holes)::integer                                             AS holes_shown,
      SUM(actual_holes)::integer                                      AS actual_holes_completed,
      bool_or(is_live)                                                AS is_live,
      CASE
        WHEN v_scoring_model = 'stableford_points' THEN SUM(stab_par)::integer
        ELSE SUM(par)::integer
      END                                                             AS course_par,
      CASE
        WHEN v_scoring_model = 'stableford_points' THEN SUM(pts)::numeric
        ELSE NULL
      END                                                             AS format_pts
    FROM (
      SELECT profile_id AS pid, gross, hcp, holes, actual_holes, pts, stab_par, false AS is_live, par
        FROM full_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, actual_holes, pts, stab_par, false, par
        FROM partial_scores
      UNION ALL
      SELECT profile_id, gross, hcp, holes, actual_holes, pts, stab_par, true, par
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
        c.net_score ASC NULLS LAST,
        c.holes_shown DESC,
        c.pid ASC
    )::integer AS leaderboard_pos,
    CASE
      WHEN c.net_score IS NOT NULL AND c.course_par IS NOT NULL
      THEN c.net_score - c.course_par
      ELSE NULL
    END AS to_par,
    c.format_pts AS format_points
  FROM combined c;
END;
$$;

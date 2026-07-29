-- ============================================================
-- A picked-up hole must score net double bogey, not zero.
--
-- Picking up writes TWO rows: round_hole_states.status = 'picked_up'
-- AND a round_score_events row with strokes = NULL. Every score lateral
-- in the two leaderboard functions did `SUM(latest.strokes)` (which
-- SKIPS the NULL → contributes 0) alongside `COUNT(*)` (which COUNTS
-- the row → the hole is "played"), and none of them ever joined
-- round_hole_states. Net effect for a pick-up on hole 1, par 4, with 2
-- strokes received:
--
--     gross_score = 0, net_score = -2, to_par = -6, position = 1
--
-- i.e. picking up put a player top of the leaderboard at six under.
-- The scorecard meanwhile displayed the correct "8 PU", because the
-- client applies netDoubleBogeyGross() (lib/rounds/handicapUtils.ts).
--
-- The same asymmetry sat in FOUR places in ciaga_compute_event_leaderboard
-- (stableford points, stableford gross, the submitted raw-gross lateral,
-- and the live_rounds lateral) and FOUR in ciaga_get_frozen_leaderboard.
-- The submitted lateral is the worst of them: a non-NULL raw.gross stops
-- the COALESCE(raw.gross, hrr.adjusted_gross_score) fallback from firing,
-- so a FINISHED round silently under-counted every picked-up hole too.
--
-- Fix: one view, public.round_effective_scores, resolves the latest score
-- event per hole and applies WHS net double bogey (par + 2 + strokes
-- received) for picked-up holes, matching the scorecard exactly. Every
-- lateral in both functions now reads it instead of round_score_events.
--
-- Bodies are otherwise carried over verbatim from
-- 20260610000007_event_results_use_raw_gross.sql. CREATE OR REPLACE (not
-- DROP) so EXECUTE grants are preserved.
-- ============================================================

-- ── 0. round_effective_scores ────────────────────────────────
-- Latest score per (round, participant, hole), with the pick-up rule
-- applied once, in one place.
--
--   effective_strokes  strokes to COUNT toward gross: raw for a completed
--                      hole, net double bogey for a picked-up one, NULL
--                      for a hole not yet played.
--   counts_as_played   whether the hole contributes to holes_completed.
--   ndb_strokes        exposed so the submitted path can also apply WHS
--                      Rule 3.1 to not-started holes on a finished card.
--
-- Handicap basis is course_handicap_used — the same value the scorecard
-- passes to netDoubleBogeyGross(), so the displayed "8" and the
-- leaderboard's "8" cannot diverge.
-- Driven by holes the player has actually touched (a score event or a hole
-- state), NOT by the tee snapshot — a round whose course has no hole data
-- (OSM-imported courses land this way) must still report its raw strokes
-- rather than vanishing behind an inner join. Par/SI are LEFT JOINed, and
-- a pick-up on a hole with no par is left uncounted rather than counted as
-- zero, which is the safer of the two wrong answers available.
CREATE OR REPLACE VIEW public.round_effective_scores AS
SELECT
  rp.round_id,
  rp.id                                            AS participant_id,
  h.hole_number,
  ls.strokes                                       AS raw_strokes,
  COALESCE(hst.status::text, 'not_started')        AS hole_status,
  rhs.par,
  rhs.stroke_index,
  CASE WHEN rhs.par IS NOT NULL THEN
    (rhs.par + 2 + alloc.base
      + CASE WHEN alloc.rem > 0 AND rhs.stroke_index <= alloc.rem THEN 1 ELSE 0 END
    )::integer
  END                                              AS ndb_strokes,
  CASE
    WHEN COALESCE(hst.status::text, 'not_started') = 'picked_up' THEN
      CASE WHEN rhs.par IS NOT NULL THEN
        (rhs.par + 2 + alloc.base
          + CASE WHEN alloc.rem > 0 AND rhs.stroke_index <= alloc.rem THEN 1 ELSE 0 END
        )::integer
      END
    ELSE ls.strokes
  END                                              AS effective_strokes,
  (
    (COALESCE(hst.status::text, 'not_started') = 'picked_up' AND rhs.par IS NOT NULL)
    OR ls.strokes IS NOT NULL
  )                                                AS counts_as_played
FROM round_participants rp
CROSS JOIN LATERAL (
  SELECT DISTINCT hole_number FROM (
    SELECT rse.hole_number
    FROM round_score_events rse
    WHERE rse.round_id = rp.round_id AND rse.participant_id = rp.id
    UNION
    SELECT rhs2.hole_number
    FROM round_hole_states rhs2
    WHERE rhs2.participant_id = rp.id
    UNION
    SELECT rhsn.hole_number
    FROM round_hole_snapshots rhsn
    WHERE rhsn.round_tee_snapshot_id = rp.tee_snapshot_id
  ) all_holes
) h
LEFT JOIN round_tee_snapshots rts
  ON rts.id = rp.tee_snapshot_id
LEFT JOIN round_hole_snapshots rhs
  ON rhs.round_tee_snapshot_id = rp.tee_snapshot_id
 AND rhs.hole_number = h.hole_number
CROSS JOIN LATERAL (
  SELECT
    FLOOR(COALESCE(rp.course_handicap_used, 0)::numeric
          / GREATEST(COALESCE(rts.holes_count, 18), 1))::integer AS base,
    COALESCE(rp.course_handicap_used, 0)
      - FLOOR(COALESCE(rp.course_handicap_used, 0)::numeric
              / GREATEST(COALESCE(rts.holes_count, 18), 1))::integer
        * GREATEST(COALESCE(rts.holes_count, 18), 1)             AS rem
) alloc
LEFT JOIN round_hole_states hst
  ON hst.participant_id = rp.id
 AND hst.hole_number = h.hole_number
LEFT JOIN LATERAL (
  SELECT DISTINCT ON (rse.hole_number) rse.strokes
  FROM round_score_events rse
  WHERE rse.round_id = rp.round_id
    AND rse.participant_id = rp.id
    AND rse.hole_number = h.hole_number
  ORDER BY rse.hole_number, rse.created_at DESC, rse.id DESC
) ls ON true;

GRANT SELECT ON public.round_effective_scores TO anon, authenticated, service_role;

-- ── 1. ciaga_compute_event_leaderboard ───────────────────────
-- Base: 20260610000007. Only the four score laterals change.
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
  v_group_season_id   uuid;
  v_contribution      text;
  v_points_model      text;
  v_points_table      jsonb;
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
  -- Handicap allowance from event rules
  v_handicap_mode     text    := 'none';
  v_allowance_pct     numeric := 100;
BEGIN
  SELECT
    scoring_model::text,
    num_rounds,
    group_id,
    group_season_id,
    standings_contribution,
    points_model::text,
    points_table,
    points_config
  INTO
    v_scoring_model, v_num_rounds, v_group_id, v_group_season_id, v_contribution,
    v_points_model, v_points_table, v_points_config
  FROM events
  WHERE id = p_event_id;

  -- Read event handicap allowance rules
  SELECT
    COALESCE(handicap_rules->>'mode', 'none'),
    COALESCE((handicap_rules->>'allowance_pct')::numeric, 100)
  INTO v_handicap_mode, v_allowance_pct
  FROM events
  WHERE id = p_event_id;

  v_num_rounds   := COALESCE(v_num_rounds, 1);
  v_points_table := COALESCE(v_points_table, '{}'::jsonb);
  v_points_config := COALESCE(v_points_config, '{}'::jsonb);

  IF v_points_model IN ('ciaga_formula', 'custom_formula') THEN
    v_base_pts          := COALESCE((v_points_config->>'base')::numeric,              18);
    v_scale_pts         := COALESCE((v_points_config->>'scale')::numeric,             32);
    v_compression       := COALESCE((v_points_config->>'compression')::numeric,        0.7);
    v_field_sensitivity := COALESCE((v_points_config->>'field_sensitivity')::numeric,  0.2);
    v_win_bonus_scale   := COALESCE((v_points_config->>'win_bonus_scale')::numeric,    5);
    v_round_coeff       := COALESCE((v_points_config->>'round_coefficient')::numeric,  0.2);
    v_round_factor      := 1.0 + v_round_coeff * (LEAST(v_num_rounds, 3) - 1);

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
            agg.holes_completed DESC
            -- last_submission_at removed: equal net_score + holes_completed → same RANK
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
          VALUES (
            CASE
              WHEN rp.assigned_playing_handicap IS NOT NULL
                   THEN rp.assigned_playing_handicap
              WHEN v_handicap_mode = 'allowance_pct'
                   THEN ROUND(COALESCE(rp.course_handicap_used, 0)::numeric * v_allowance_pct / 100)::integer
              ELSE COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)
            END
          )
        ) AS hv(hcp)
        CROSS JOIN LATERAL (
          VALUES (FLOOR(hv.hcp::numeric / 18)::integer)
        ) AS hb(base)
        CROSS JOIN LATERAL (
          VALUES (hv.hcp - hb.base * 18)
        ) AS hr(rem)
        LEFT JOIN LATERAL (
          -- Pick-ups score net double bogey, so they earn 0 stableford
          -- points rather than dropping out of the SUM entirely.
          SELECT
            COALESCE(SUM(GREATEST(0, 2 - (
              es.effective_strokes
              - hb.base
              - CASE WHEN es.stroke_index <= hr.rem THEN 1 ELSE 0 END
              - es.par
            ))), 0)::integer                            AS pts,
            COALESCE(SUM(es.effective_strokes), 0)::integer AS gross,
            COALESCE(SUM(es.par), 0)::integer              AS par_sum,
            COUNT(*)::integer                              AS hole_count
          FROM round_effective_scores es
          WHERE es.round_id = s.round_id
            AND es.participant_id = rp.id
            AND es.counts_as_played
        ) hole_pts ON true
        WHERE s.event_id = p_event_id
          AND s.accepted = true
          AND v_scoring_model = 'stableford_points'
        GROUP BY s.profile_id
      ),

      submitted AS (
        SELECT
          s.profile_id,
          -- Actual gross from hole scores (latest event per hole). The WHS
          -- net-double-bogey adjusted gross exists for handicapping only;
          -- event results rank on real strokes. Falls back to the adjusted
          -- gross for legacy/manual submissions with no hole-level data.
          SUM(COALESCE(raw.gross, hrr.adjusted_gross_score))::integer                    AS submitted_gross,
          SUM(
            CASE
              WHEN rp.assigned_playing_handicap IS NOT NULL
                   THEN rp.assigned_playing_handicap
              WHEN v_handicap_mode = 'allowance_pct'
                   THEN ROUND(COALESCE(rp.course_handicap_used, 0)::numeric * v_allowance_pct / 100)::integer
              ELSE COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)
            END
          )::integer                                                                      AS submitted_hcp,
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
        LEFT JOIN LATERAL (
          -- Finished card: picked-up holes score NDB, and WHS Rule 3.1
          -- gives not-started holes NDB too. NULLIF keeps the
          -- adjusted-gross fallback alive for legacy/manual submissions
          -- that carry no hole-level data at all.
          SELECT NULLIF(SUM(
            COALESCE(es.effective_strokes, es.ndb_strokes)
          ), 0)::integer AS gross
          FROM round_effective_scores es
          WHERE es.round_id = s.round_id
            AND es.participant_id = rp.id
        ) raw ON true
        WHERE s.event_id = p_event_id
          AND s.accepted = true
        GROUP BY s.profile_id
      ),

      live_rounds AS (
        SELECT
          rp.profile_id,
          COALESCE(scores.total_strokes, 0)::integer                              AS live_gross,
          COALESCE(scores.hole_count, 0)::integer                                 AS live_holes,
          CASE
            WHEN rp.assigned_playing_handicap IS NOT NULL
                 THEN rp.assigned_playing_handicap
            WHEN v_handicap_mode = 'allowance_pct'
                 THEN ROUND(COALESCE(rp.course_handicap_used, 0)::numeric * v_allowance_pct / 100)::integer
            ELSE COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)
          END                                                                       AS course_hcp,
          -- Proportional par: retained as fallback when tee snapshot unavailable
          CASE WHEN COALESCE(scores.hole_count, 0) > 0 AND rts.par_total IS NOT NULL
            THEN ROUND(
              rts.par_total::numeric
              * COALESCE(scores.hole_count, 0)
              / COALESCE(rts.holes_count, 18)
            )::integer
            ELSE NULL
          END                                                                       AS live_par,
          COALESCE(stab_pts_lat.pts, 0)::integer                                   AS live_stab_total,
          COALESCE(stab_pts_lat.par_exact, 0)::integer                             AS live_par_exact,
          -- Per-hole handicap strokes for holes actually played (matches Group tab formula)
          live_hcp_lat.hcp_strokes                                                  AS live_hcp_strokes,
          -- Exact par for the holes played: fixes to_par for unequal front/back nines
          live_hcp_lat.live_par_exact_holes                                         AS live_par_exact_sp
        FROM event_tee_times ctt
        JOIN rounds r
          ON r.event_tee_time_id = ctt.id
          AND r.status = 'live'
        JOIN round_participants rp
          ON rp.round_id = r.id
        LEFT JOIN round_tee_snapshots rts
          ON rts.id = rp.tee_snapshot_id
        LEFT JOIN LATERAL (
          -- THE bug: SUM(strokes) skipped the pick-up's NULL while
          -- COUNT(*) still counted the hole, so gross went to 0 and the
          -- player led at six under. effective_strokes carries NDB.
          SELECT
            SUM(es.effective_strokes) AS total_strokes,
            COUNT(*)                  AS hole_count
          FROM round_effective_scores es
          WHERE es.round_id = r.id
            AND es.participant_id = rp.id
            AND es.counts_as_played
        ) scores ON true
        CROSS JOIN LATERAL (
          VALUES (
            CASE
              WHEN rp.assigned_playing_handicap IS NOT NULL
                   THEN rp.assigned_playing_handicap
              WHEN v_handicap_mode = 'allowance_pct'
                   THEN ROUND(COALESCE(rp.course_handicap_used, 0)::numeric * v_allowance_pct / 100)::integer
              ELSE COALESCE(rp.playing_handicap_used, rp.course_handicap_used, 0)
            END
          )
        ) AS hv(hcp)
        -- Use actual course hole count for base/rem so 9-hole courses allocate correctly
        CROSS JOIN LATERAL (
          VALUES (COALESCE(rts.holes_count, 18))
        ) AS hc(holes_count)
        CROSS JOIN LATERAL (
          VALUES (FLOOR(hv.hcp::numeric / hc.holes_count)::integer)
        ) AS hb(base)
        CROSS JOIN LATERAL (
          VALUES (hv.hcp::integer - hb.base * hc.holes_count)
        ) AS hr(rem)
        -- Stableford per-hole points (no-op for non-stableford)
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(GREATEST(0, 2 - (
              es.effective_strokes
              - hb.base
              - CASE WHEN es.stroke_index <= hr.rem THEN 1 ELSE 0 END
              - es.par
            ))), 0)          AS pts,
            SUM(es.par)      AS par_exact
          FROM round_effective_scores es
          WHERE es.round_id = r.id
            AND es.participant_id = rp.id
            AND es.counts_as_played
            AND es.par IS NOT NULL
            AND v_scoring_model = 'stableford_points'
        ) stab_pts_lat ON true
        -- Per-hole handicap strokes + exact par for holes played (all scoring models).
        -- A picked-up hole counts here as played, matching live_gross.
        LEFT JOIN LATERAL (
          SELECT
            SUM(hb.base + CASE WHEN es.stroke_index <= hr.rem THEN 1 ELSE 0 END)::integer AS hcp_strokes,
            SUM(es.par)::integer AS live_par_exact_holes
          FROM round_effective_scores es
          WHERE es.round_id = r.id
            AND es.participant_id = rp.id
            AND es.counts_as_played
        ) live_hcp_lat ON true
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
                   - CASE WHEN v_scoring_model = 'gross' THEN 0
                       ELSE COALESCE(sub.submitted_hcp, 0)
                              -- Per-hole allocation; proportional fallback when tee snapshot unavailable
                              + COALESCE(
                                  live.live_hcp_strokes,
                                  FLOOR(COALESCE(live.course_hcp, 0)
                                      * COALESCE(live.live_holes, 0) / 18.0)::integer
                                )
                     END
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
              THEN COALESCE(sub.submitted_par, 0)
                   + COALESCE(live.live_par_exact_sp, live.live_par, 0)
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

  -- Consider the freeze BEFORE cascading into standings. The other order let a
  -- score publish unmasked live standings and only then decide the event should
  -- have been frozen — a one-recompute spoiler window on every score entry.
  PERFORM ciaga_check_leaderboard_auto_freeze(p_event_id);

  IF v_group_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_group_standings(v_group_id);
  END IF;

  IF v_group_season_id IS NOT NULL AND v_contribution IN ('season', 'both') THEN
    PERFORM ciaga_compute_group_season_standings(v_group_season_id);
  END IF;
END;
$$;

-- ── 2. ciaga_get_frozen_leaderboard ──────────────────────────
-- Base: 20260529000004_stableford_frozen_leaderboard_net_equivalent.sql.
-- Only sub_details changes: full_gross from raw hole scores with
-- adjusted-gross fallback.
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
    SELECT
      s.profile_id,
      s.round_id,
      ROW_NUMBER() OVER (PARTITION BY s.profile_id ORDER BY s.submitted_at) AS round_num
    FROM event_round_submissions s
    WHERE s.event_id = p_event_id AND s.accepted = true
  ),

  sub_details AS (
    SELECT
      rs.profile_id,
      rs.round_num,
      rs.round_id,
      (rs.round_num - 1) * 18                               AS range_start,
      rs.round_num * 18                                     AS range_end,
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
      SELECT COALESCE(COUNT(*), 0) * 18 AS range_start
      FROM event_round_submissions s3
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

-- ── 3. Repair events a pick-up has already corrupted ──────────
--
-- Two steps, and the ORDER MATTERS.
--
-- Step 1 recomputes event_leaderboard_entries with the corrected laterals.
-- Recomputing alone is not enough for a frozen event: freeze snapshots are
-- written by trigger with ON CONFLICT DO NOTHING (20260529000005), so a
-- snapshot that already captured the bad numbers survives untouched.
--
-- But the snapshots cannot simply be dropped and left to the trigger to
-- rebuild either. The trigger stores NEW.gross_score — the player's FULL
-- current gross — and labels it holes_shown = threshold. That is only
-- correct at the instant the player crosses the line; re-firing it later
-- would bake post-threshold holes into a row the UI presents as "thru N",
-- i.e. it would leak exactly what the ceremony is hiding.
--
-- So step 2 rebuilds each frozen event's snapshots from
-- ciaga_get_frozen_leaderboard, which clips to the threshold properly.
--
-- Scope: events not yet 'revealed'. Revealed history is left alone so
-- published results don't silently change under people.
DO $$
DECLARE
  v_id        uuid;
  v_threshold integer;
BEGIN
  -- Step 1: corrected leaderboard for anything still in flight.
  FOR v_id IN
    SELECT id FROM public.events
    WHERE majors_status IN ('upcoming', 'live')
       OR COALESCE(leaderboard_freeze_state, 'live') = 'frozen'
  LOOP
    PERFORM public.ciaga_compute_event_leaderboard(v_id);
  END LOOP;

  -- Step 2: rebuild frozen snapshots from the clipping function.
  FOR v_id, v_threshold IN
    SELECT e.id,
           COALESCE(e.num_rounds, 1) * 18 - e.leaderboard_freeze_last_holes
    FROM public.events e
    WHERE COALESCE(e.leaderboard_freeze_state, 'live') = 'frozen'
      AND e.leaderboard_freeze_last_holes IS NOT NULL
  LOOP
    DELETE FROM public.event_player_freeze_snapshots WHERE event_id = v_id;

    INSERT INTO public.event_player_freeze_snapshots
      (event_id, profile_id, gross_score, net_score, to_par, format_points,
       holes_shown, actual_holes_completed, is_live, position)
    SELECT
      v_id, f.profile_id, f.gross_score, f.net_score, f.to_par, f.format_points,
      f.holes_shown, f.actual_holes_completed, f.is_live, f.leaderboard_pos
    FROM public.ciaga_get_frozen_leaderboard(v_id, v_threshold) f
    -- Only players who have actually crossed the line are frozen; everyone
    -- else keeps showing live scores off event_leaderboard_entries.
    WHERE COALESCE(f.actual_holes_completed, 0) >= v_threshold
    ON CONFLICT (event_id, profile_id) DO NOTHING;
  END LOOP;
END $$;

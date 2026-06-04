-- ============================================================
-- Live leaderboard: hole-by-hole updates, season cascade, realtime
-- ============================================================

-- Add live tracking columns to competition_leaderboard_entries
ALTER TABLE public.competition_leaderboard_entries
  ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS holes_completed integer NOT NULL DEFAULT 0;

-- ── Updated ciaga_compute_competition_leaderboard ─────────────
-- Now includes in-progress round scores alongside accepted submissions.
-- Cascades to group and season standings automatically.
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
        SUM(hrr.adjusted_gross_score)::integer                            AS submitted_gross,
        SUM(COALESCE(rp.course_handicap_used, 0))::integer                AS submitted_hcp,
        SUM(CASE WHEN hrr.is_9_hole THEN 9 ELSE 18 END)::integer          AS submitted_holes,
        COUNT(*)::integer                                                  AS rounds_submitted,
        MAX(s.submitted_at)                                                AS last_submission_at
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
        COALESCE(scores.total_strokes, 0)::integer   AS live_gross,
        COALESCE(scores.hole_count, 0)::integer      AS live_holes,
        COALESCE(rp.course_handicap_used, 0)         AS course_hcp
      FROM competition_tee_times ctt
      JOIN rounds r
        ON r.competition_tee_time_id = ctt.id
        AND r.status IN ('scheduled', 'in_progress')
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
END;
$$;

-- ── Trigger: recompute leaderboard on each score event ────────
CREATE OR REPLACE FUNCTION public.ciaga_on_score_event_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_competition_id uuid;
BEGIN
  SELECT ctt.competition_id INTO v_competition_id
  FROM rounds r
  JOIN competition_tee_times ctt ON ctt.id = r.competition_tee_time_id
  WHERE r.id = NEW.round_id
    AND r.competition_tee_time_id IS NOT NULL;

  IF v_competition_id IS NOT NULL THEN
    PERFORM ciaga_compute_competition_leaderboard(v_competition_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_event_recompute_leaderboard ON public.round_score_events;
CREATE TRIGGER trg_score_event_recompute_leaderboard
  AFTER INSERT ON public.round_score_events
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_score_event_inserted();

-- ── Trigger: cascade group + season standings on competition complete ──
CREATE OR REPLACE FUNCTION public.ciaga_on_competition_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.majors_status = 'completed'
     AND (OLD.majors_status IS DISTINCT FROM 'completed')
     AND NEW.standings_contribution IN ('season', 'both')
  THEN
    IF NEW.group_id IS NOT NULL THEN
      PERFORM ciaga_compute_group_standings(NEW.group_id);
    END IF;
    IF NEW.season_id IS NOT NULL THEN
      PERFORM ciaga_compute_season_standings(NEW.season_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_competition_completed_cascade ON public.competitions;
CREATE TRIGGER trg_competition_completed_cascade
  AFTER UPDATE ON public.competitions
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_competition_completed();

-- ── Enable Realtime on competition_leaderboard_entries ────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'competition_leaderboard_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_leaderboard_entries;
  END IF;
END;
$$;

-- ============================================================
-- Season configuration snapshot
--
-- Freezes the standings config on competition_seasons when a
-- season first leaves draft so that future edits to standings_model
-- or standings_rules_version_id cannot silently corrupt historical
-- season standings on recompute.
--
-- Also guards ciaga_on_submission_change to prevent accepted
-- submissions from triggering a leaderboard recompute on events
-- that have already been marked 'official'.
-- ============================================================

-- ── 1. Add config_snapshot column ───────────────────────────
ALTER TABLE public.competition_seasons
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb DEFAULT NULL;

COMMENT ON COLUMN public.competition_seasons.config_snapshot IS
  'Frozen copy of standings config (standings_model, standings_rules_version_id) captured '
  'the first time the season leaves draft status. Used by ciaga_compute_season_standings '
  'in preference to the live columns so admin edits do not retroactively alter past standings.';

-- ── 2. Backfill existing non-draft seasons ───────────────────
UPDATE public.competition_seasons
SET config_snapshot = jsonb_build_object(
  'standings_model',            standings_model::text,
  'standings_rules_version_id', standings_rules_version_id::text,
  'captured_at',                now()::text
)
WHERE config_snapshot IS NULL
  AND status <> 'draft';

-- ── 3. Trigger: freeze config on first transition out of draft ─
CREATE OR REPLACE FUNCTION public.ciaga_freeze_season_config()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.config_snapshot IS NULL
     AND NEW.status IS DISTINCT FROM 'draft'
     AND (OLD IS NULL OR OLD.status = 'draft')
  THEN
    NEW.config_snapshot := jsonb_build_object(
      'standings_model',            NEW.standings_model::text,
      'standings_rules_version_id', NEW.standings_rules_version_id::text,
      'captured_at',                now()::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_freeze_season_config
  BEFORE UPDATE ON public.competition_seasons
  FOR EACH ROW EXECUTE FUNCTION public.ciaga_freeze_season_config();

-- ── 4. Update ciaga_compute_season_standings ─────────────────
-- Reads standings_model from config_snapshot when present,
-- falling back to the live column for seasons without a snapshot
-- (draft seasons, or backfill edge cases).
CREATE OR REPLACE FUNCTION public.ciaga_compute_season_standings(p_season_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_standings_model text;
  v_snapshot        jsonb;
BEGIN
  SELECT standings_model::text, config_snapshot
    INTO v_standings_model, v_snapshot
  FROM competition_seasons
  WHERE id = p_season_id;

  -- Prefer the frozen snapshot over the live column
  IF v_snapshot IS NOT NULL AND v_snapshot ? 'standings_model' THEN
    v_standings_model := v_snapshot->>'standings_model';
  END IF;

  DELETE FROM season_standings_entries
  WHERE season_id = p_season_id;

  INSERT INTO season_standings_entries
    (season_id, profile_id, season_points, events_played, wins, top_3s, best_finish, position, last_computed_at)
  SELECT
    p_season_id,
    agg.profile_id,
    COALESCE(SUM(agg.points_earned), 0)                           AS season_points,
    COUNT(DISTINCT agg.event_id)::integer                         AS events_played,
    COUNT(*) FILTER (WHERE agg.position = 1)::integer             AS wins,
    COUNT(*) FILTER (WHERE agg.position <= 3)::integer            AS top_3s,
    MIN(agg.position)                                             AS best_finish,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE(SUM(agg.points_earned), 0) DESC,
        COUNT(*) FILTER (WHERE agg.position = 1) DESC,
        COUNT(*) FILTER (WHERE agg.position <= 3) DESC
    )::integer AS position,
    NOW() AS last_computed_at
  FROM event_leaderboard_entries agg
  JOIN events e ON e.id = agg.event_id
  WHERE e.season_id = p_season_id
    AND e.standings_contribution IN ('season', 'both')
    AND e.majors_status IN ('completed', 'official')
  GROUP BY agg.profile_id;
END;
$$;

-- ── 5. Guard submission trigger against official events ───────
-- Prevents an accepted submission from triggering a leaderboard
-- recompute on an event already marked 'official'. Config changes
-- on official events therefore cannot propagate into stored results
-- via the trigger path.
CREATE OR REPLACE FUNCTION public.ciaga_on_submission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.accepted = true AND (OLD IS NULL OR OLD.accepted IS DISTINCT FROM true) THEN
    SELECT majors_status::text INTO v_status
    FROM events
    WHERE id = NEW.event_id;

    IF v_status IS DISTINCT FROM 'official' THEN
      PERFORM ciaga_compute_event_leaderboard(NEW.event_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

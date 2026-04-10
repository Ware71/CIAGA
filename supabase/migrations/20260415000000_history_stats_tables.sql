-- ============================================================
-- Majors: event_history_summaries and profile_competition_stats
-- Precomputed summary tables for historical continuity.
-- Also includes DB functions to refresh these tables.
-- ============================================================

-- ── event_history_summaries ───────────────────────────────────
-- One row per (recurring event template, year).
-- Populated when a competition is marked completed/official.
CREATE TABLE public.event_history_summaries (
  series_event_template_id uuid NOT NULL REFERENCES public.series_event_templates(id) ON DELETE CASCADE,
  season_id                uuid REFERENCES public.series_seasons(id) ON DELETE SET NULL,
  competition_id           uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  season_year              integer NOT NULL,
  winner_profile_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  runner_up_profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  winning_score_summary    text,        -- e.g. "-4", "3&2", "69"
  field_size               integer NOT NULL DEFAULT 0,
  completed_at             timestamptz,
  PRIMARY KEY (series_event_template_id, season_year)
);

CREATE INDEX idx_ehs_competition ON public.event_history_summaries(competition_id);
CREATE INDEX idx_ehs_winner ON public.event_history_summaries(winner_profile_id);

ALTER TABLE public.event_history_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_history_summaries_select"
  ON public.event_history_summaries FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.event_history_summaries TO authenticated;
GRANT ALL ON public.event_history_summaries TO service_role;

-- ── profile_competition_stats ─────────────────────────────────
-- Precomputed career stats per player, optionally scoped to a group or series.
CREATE TABLE public.profile_competition_stats (
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id        uuid REFERENCES public.major_groups(id) ON DELETE CASCADE,
  series_id       uuid REFERENCES public.competition_series(id) ON DELETE CASCADE,
  wins            integer NOT NULL DEFAULT 0,
  runner_ups      integer NOT NULL DEFAULT 0,
  top_3s          integer NOT NULL DEFAULT 0,
  events_played   integer NOT NULL DEFAULT 0,
  stroke_play_wins integer NOT NULL DEFAULT 0,
  matchplay_wins  integer NOT NULL DEFAULT 0,
  major_wins      integer NOT NULL DEFAULT 0,
  season_titles   integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Use a partial unique index to handle nullable columns correctly
CREATE UNIQUE INDEX idx_pcs_global ON public.profile_competition_stats(profile_id)
  WHERE group_id IS NULL AND series_id IS NULL;

CREATE UNIQUE INDEX idx_pcs_group ON public.profile_competition_stats(profile_id, group_id)
  WHERE group_id IS NOT NULL AND series_id IS NULL;

CREATE UNIQUE INDEX idx_pcs_series ON public.profile_competition_stats(profile_id, series_id)
  WHERE series_id IS NOT NULL AND group_id IS NULL;

CREATE INDEX idx_pcs_profile ON public.profile_competition_stats(profile_id);

ALTER TABLE public.profile_competition_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_competition_stats_select"
  ON public.profile_competition_stats FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.profile_competition_stats TO authenticated;
GRANT ALL ON public.profile_competition_stats TO service_role;

-- ── ciaga_refresh_event_history_summary ──────────────────────
-- Called when a competition is marked completed/official.
-- Populates event_history_summaries from leaderboard entries.
CREATE OR REPLACE FUNCTION public.ciaga_refresh_event_history_summary(p_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_template_id uuid;
  v_season_id   uuid;
  v_year        integer;
  v_winner      uuid;
  v_runner_up   uuid;
  v_win_score   text;
  v_field_size  integer;
BEGIN
  -- Check this competition has a template linkage
  SELECT series_event_template_id, season_id, competition_year
  INTO v_template_id, v_season_id, v_year
  FROM competitions
  WHERE id = p_competition_id;

  IF v_template_id IS NULL OR v_year IS NULL THEN
    RETURN;  -- Not a recurring event; skip
  END IF;

  -- Get winner (position = 1) and runner-up (position = 2)
  SELECT profile_id, net_score::text
  INTO v_winner, v_win_score
  FROM competition_leaderboard_entries
  WHERE competition_id = p_competition_id AND position = 1
  LIMIT 1;

  SELECT profile_id
  INTO v_runner_up
  FROM competition_leaderboard_entries
  WHERE competition_id = p_competition_id AND position = 2
  LIMIT 1;

  -- Get field size
  SELECT COUNT(DISTINCT profile_id)::integer
  INTO v_field_size
  FROM competition_leaderboard_entries
  WHERE competition_id = p_competition_id;

  INSERT INTO event_history_summaries
    (series_event_template_id, season_id, competition_id, season_year,
     winner_profile_id, runner_up_profile_id, winning_score_summary,
     field_size, completed_at)
  VALUES
    (v_template_id, v_season_id, p_competition_id, v_year,
     v_winner, v_runner_up, v_win_score,
     COALESCE(v_field_size, 0), NOW())
  ON CONFLICT (series_event_template_id, season_year)
  DO UPDATE SET
    competition_id          = EXCLUDED.competition_id,
    season_id               = EXCLUDED.season_id,
    winner_profile_id       = EXCLUDED.winner_profile_id,
    runner_up_profile_id    = EXCLUDED.runner_up_profile_id,
    winning_score_summary   = EXCLUDED.winning_score_summary,
    field_size              = EXCLUDED.field_size,
    completed_at            = EXCLUDED.completed_at;
END;
$$;

-- ── ciaga_refresh_profile_stats ───────────────────────────────
-- Rebuilds profile_competition_stats for a given profile globally.
-- Aggregates from competition_leaderboard_entries.
CREATE OR REPLACE FUNCTION public.ciaga_refresh_profile_stats(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete and rebuild global stats
  DELETE FROM profile_competition_stats
  WHERE profile_id = p_profile_id
    AND group_id IS NULL AND series_id IS NULL;

  INSERT INTO profile_competition_stats
    (profile_id, group_id, series_id,
     wins, runner_ups, top_3s, events_played,
     stroke_play_wins, matchplay_wins, major_wins,
     updated_at)
  SELECT
    p_profile_id,
    NULL, NULL,
    COUNT(*) FILTER (WHERE cle.position = 1),
    COUNT(*) FILTER (WHERE cle.position = 2),
    COUNT(*) FILTER (WHERE cle.position <= 3),
    COUNT(DISTINCT c.id),
    COUNT(*) FILTER (WHERE cle.position = 1 AND c.competition_type NOT IN ('matchplay', 'matchplay_fixture', 'matchplay_knockout_match')),
    COUNT(*) FILTER (WHERE cle.position = 1 AND c.competition_type IN ('matchplay', 'matchplay_fixture', 'matchplay_knockout_match')),
    -- major_wins = wins in competitions that belong to a major_series
    COUNT(*) FILTER (
      WHERE cle.position = 1
        AND EXISTS (
          SELECT 1 FROM competition_series cs
          JOIN major_groups mg ON mg.id = cs.group_id
          WHERE cs.id = c.series_id
            AND (mg.type = 'major_series' OR mg.type = 'major_series_host')
        )
    ),
    NOW()
  FROM competition_leaderboard_entries cle
  JOIN competitions c ON c.id = cle.competition_id
  WHERE cle.profile_id = p_profile_id
    AND c.majors_status IN ('completed', 'official');
END;
$$;

-- Enable Realtime on season_standings_entries and major_group_standings
-- so the scorecard leaderboard sheet receives live updates during active play.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'season_standings_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.season_standings_entries;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'major_group_standings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.major_group_standings;
  END IF;
END;
$$;

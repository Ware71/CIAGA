-- Supabase Realtime column filters require REPLICA IDENTITY FULL on the
-- table. competition_leaderboard_entries uses a filter on competition_id
-- (not the primary key), so without this the filtered subscription
-- receives no events and the live leaderboard never auto-refreshes.
ALTER TABLE public.competition_leaderboard_entries REPLICA IDENTITY FULL;

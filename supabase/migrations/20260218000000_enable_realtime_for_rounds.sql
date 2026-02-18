-- Enable Supabase Realtime for tables used in live score/hole-state subscriptions.
-- Prod had these enabled via the dashboard; this migration syncs staging.

alter publication supabase_realtime add table round_score_events;
alter publication supabase_realtime add table round_hole_states;
alter publication supabase_realtime add table round_participants;
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table round_hole_snapshots;

-- Enable Supabase Realtime for tables used in live score/hole-state subscriptions.
-- Prod had these enabled via the dashboard; this migration syncs staging.
-- Idempotent: skips tables already in the publication.

do $$
declare
  t text;
begin
  foreach t in array array[
    'round_score_events',
    'round_hole_states',
    'round_participants',
    'rounds',
    'round_hole_snapshots'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

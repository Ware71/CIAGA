-- Add playing_handicap_used to round_teams
-- Computed at round start from individual member course handicaps using WHS formula.
-- Null until round is started.

ALTER TABLE public.round_teams
  ADD COLUMN IF NOT EXISTS playing_handicap_used integer;

COMMENT ON COLUMN public.round_teams.playing_handicap_used IS
  'Locked snapshot: Team playing handicap at round start, computed via WHS formula from member course handicaps. Used for net team scoring in scramble/greensomes/foursomes.';

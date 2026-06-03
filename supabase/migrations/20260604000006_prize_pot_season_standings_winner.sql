-- Add season_standings_winner distribution type to prize_pots
-- This awards the pot to position 1 in the season standings when the season completes.
-- Ties split equally.

ALTER TABLE public.prize_pots
  DROP CONSTRAINT IF EXISTS prize_pots_distribution_type_check;

ALTER TABLE public.prize_pots
  ADD CONSTRAINT prize_pots_distribution_type_check
    CHECK (distribution_type IN (
      'position_based',          -- 1st/2nd/3rd splits from prize_table JSON
      'metric_weighted',         -- proportional to metric value (e.g. 3 twos → 3× share)
      'metric_equal',            -- equal share to each player with metric_value >= 1
      'equal_split',             -- split equally among all enrolled players
      'non_monetary',            -- no cash; prize_description only
      'entry_only',              -- entry fee charged with no distribution
      'season_standings_winner'  -- 100% (or configured prize_table) to season standings leader
    ));

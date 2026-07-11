-- ============================================================
-- Fantasy Picks V2 — model/profile/narrative foundations
--
-- 1. fantasy_player_profiles: recent_rounds (last-10 round summaries feeding
--    info popups + the narrative engine) and eagles_per_round (calibrates
--    rare-outcome markets the way birdies_per_round calibrates birdie bins).
-- 2. fantasy_event_state: narrative — the generated market-page overview,
--    rewritten on every odds refresh (realtime UPDATE pushes it to clients).
-- 3. fantasy_markets: extend the market_type whitelist with the V2 types
--    (position/range, score bands/exact, eagles, hole-specific, field
--    specials). Registry definitions land with the app code; the constraint
--    goes first so staging can price them the moment the code deploys.
-- ============================================================

ALTER TABLE public.fantasy_player_profiles
  ADD COLUMN IF NOT EXISTS recent_rounds    jsonb,
  ADD COLUMN IF NOT EXISTS eagles_per_round numeric(6,2);

ALTER TABLE public.fantasy_event_state
  ADD COLUMN IF NOT EXISTS narrative text;

ALTER TABLE public.fantasy_markets
  DROP CONSTRAINT IF EXISTS fantasy_markets_market_type_check;

ALTER TABLE public.fantasy_markets
  ADD CONSTRAINT fantasy_markets_market_type_check CHECK (
    market_type IN (
      'outright_winner', 'top_n', 'gross_ou', 'net_ou', 'birdies', 'h2h',
      'finish_position', 'finish_range', 'score_band', 'score_exact',
      'eagle_count', 'hole_score', 'field_special'
    )
  );

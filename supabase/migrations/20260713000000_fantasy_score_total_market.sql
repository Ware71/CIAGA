-- ============================================================
-- score_total market type: replaces gross_ou / net_ou / score_exact going
-- forward (one unified Under/Exact/Over table per player per basis). The old
-- three types are kept in the CHECK constraint as a SUPERSET, not swapped
-- out, because ALTER TABLE ... ADD CONSTRAINT validates existing rows and
-- staging already has generated gross_ou/net_ou/score_exact markets. The app
-- stops generating/reading those three types (getMarketDefinition() returns
-- null for them, and the odds route already filters out markets with no
-- definition), so no data migration/cleanup is needed for the orphaned rows.
-- ============================================================

ALTER TABLE public.fantasy_markets
  DROP CONSTRAINT IF EXISTS fantasy_markets_market_type_check;

ALTER TABLE public.fantasy_markets
  ADD CONSTRAINT fantasy_markets_market_type_check CHECK (
    market_type IN (
      'outright_winner', 'top_n', 'gross_ou', 'net_ou', 'birdies', 'h2h',
      'finish_position', 'finish_range', 'score_band', 'score_exact',
      'eagle_count', 'hole_score', 'field_special', 'score_total'
    )
  );

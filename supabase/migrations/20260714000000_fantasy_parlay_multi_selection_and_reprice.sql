-- Fantasy Picks — acca correctness release.
--
-- 1) fantasy_parlay_legs carried UNIQUE (parlay_id, market_id) from the
--    original parlays migration, which rejects the multi-selection-per-market
--    accas the V3 correlated model deliberately allows (two players in one
--    Top-3 row; birdie-or-better on several holes of one hole_score row).
--    Uniqueness is per SELECTION, not per market.
--
-- 2) Pricing constants changed app-side (hole-in-one 1/3500 → 1/12500,
--    albatross 1/50000 → 1/1000000, probability floor 0.005 → 0.001 = odds
--    cap 200 → 1000, prices now ladder-quantized). Mark every unsettled book
--    stale so the next board view reprices under the new constants. Open bets
--    keep their locked odds — only new prices change. Idempotent; safe to
--    re-run after the app deploy if an event refreshed in between.

-- Drop whatever the 2-column unique constraint ended up named (inline UNIQUE
-- gets the default name, but don't bet placement integrity on it).
DO $$
DECLARE
  v_name text;
BEGIN
  SELECT con.conname INTO v_name
  FROM pg_constraint con
  WHERE con.conrelid = 'public.fantasy_parlay_legs'::regclass
    AND con.contype = 'u'
    AND (SELECT array_agg(x ORDER BY x) FROM unnest(con.conkey) x) = (
      SELECT array_agg(att.attnum ORDER BY att.attnum)
      FROM pg_attribute att
      WHERE att.attrelid = 'public.fantasy_parlay_legs'::regclass
        AND att.attname IN ('parlay_id', 'market_id')
    );
  IF v_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.fantasy_parlay_legs DROP CONSTRAINT %I', v_name);
  END IF;
END $$;

ALTER TABLE public.fantasy_parlay_legs
  ADD CONSTRAINT fantasy_parlay_legs_parlay_market_selection_key
  UNIQUE (parlay_id, market_id, selection_key);

SELECT public.ciaga_fantasy_mark_stale(fes.event_id, 'pricing_constants_changed')
FROM public.fantasy_event_state fes
WHERE NOT fes.is_final;

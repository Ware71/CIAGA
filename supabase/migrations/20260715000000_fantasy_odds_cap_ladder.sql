-- Fantasy Picks — raise the snapshot odds CHECK to the new ladder top.
--
-- The V5 pricing release raised the probability floor to 0.001 and quantizes
-- every price to the bookmaker fraction ladder, whose top rung is 1000/1 =
-- decimal 1001.00. The original fantasy_odds_snapshots CHECK still enforced
-- the old 200.00 cap, so any refresh pricing a longshot above 200 failed with
-- fantasy_odds_snapshots_decimal_odds_check. Relax the bound to 1001.00
-- (probability CHECK 0<p<1 already admits the new floor).
--
-- Then re-run the mark-stale sweep: refreshes that failed against the old
-- CHECK left their jobs 'failed'; mark_stale bumps the version and re-pends a
-- job, so every open book reprices cleanly on next view. Idempotent.

ALTER TABLE public.fantasy_odds_snapshots
  DROP CONSTRAINT IF EXISTS fantasy_odds_snapshots_decimal_odds_check;

ALTER TABLE public.fantasy_odds_snapshots
  ADD CONSTRAINT fantasy_odds_snapshots_decimal_odds_check
  CHECK (decimal_odds >= 1.00 AND decimal_odds <= 1001.00);

SELECT public.ciaga_fantasy_mark_stale(fes.event_id, 'odds_cap_raised')
FROM public.fantasy_event_state fes
WHERE NOT fes.is_final;

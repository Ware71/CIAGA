-- ============================================================
-- Fantasy Picks — extended joint samples (cross-family correlated pricing)
--
-- "X wins" × "X 2+ birdies" was multiplied independently: only the finishing
-- positions matrix survived the simulation, so score/birdie legs couldn't be
-- joint-priced even though winning strongly implies birdies (the independent
-- product systematically overpays the bettor — same class as the V5 h2h
-- free-multiplier).
--
-- We now retain the other per-iteration joint samples the engine already
-- produces: birdie/eagle-or-better counts and gross/net totals (plus per-round
-- totals for multi-round events). Same encoding as matrix_b64: gzipped typed
-- array, base64. NULL columns = row predates this migration → the app falls
-- back to positions-only pricing (capability detection is column presence).
--
-- Alongside this the simulation count doubles (10k → 20k) so the 20-iteration
-- MIN_JOINT_SUPPORT floor equals the odds ladder's 0.001 probability floor:
-- joint prices can reach the full 1000/1 cap.
-- ============================================================

ALTER TABLE public.fantasy_joint_samples
  ADD COLUMN IF NOT EXISTS birdies_b64 text,       -- gzip(Int8[players × sim_count]) event birdie-or-better counts
  ADD COLUMN IF NOT EXISTS eagles_b64 text,        -- gzip(Int8[players × sim_count]) eagle-or-better counts
  ADD COLUMN IF NOT EXISTS gross_totals_b64 text,  -- gzip(Int16LE[players × sim_count])
  ADD COLUMN IF NOT EXISTS net_totals_b64 text,    -- gzip(Int16LE[players × sim_count])
  -- Multi-round events only: {"1":{"gross_b64":…,"net_b64":…,"birdies_b64":…}, …}
  ADD COLUMN IF NOT EXISTS round_totals jsonb;

-- Reprice every non-final book so extended bundles (and 20k-iteration prices)
-- exist without waiting for organic staleness (mirrors 20260714's sweep).
SELECT public.ciaga_fantasy_mark_stale(fes.event_id, 'joint_bundle_extended')
FROM public.fantasy_event_state fes
WHERE NOT fes.is_final;

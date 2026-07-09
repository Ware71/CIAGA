-- ============================================================
-- Fantasy Picks V3 — WHS Score-Differential model inputs
--
-- The odds model moves off a flat gross average (normalised to par only, so
-- blind to course difficulty) onto WHS Score Differentials, which normalise
-- for rating + slope. Profiles now carry a recency-weighted mean/variance of
-- the player's FULL differential history (no 20-round ability cap), sourced
-- from the canonical ciaga_scoring_record_stream view (accepted rounds only,
-- 9-hole rounds already reduced to 18-hole-equivalent differentials).
--
-- avg_gross / score_stddev are kept: they still feed info popups + the
-- narrative, and are the fallback when a player has no accepted differentials
-- or the event tee has no rating/slope.
-- ============================================================

ALTER TABLE public.fantasy_player_profiles
  ADD COLUMN IF NOT EXISTS avg_differential         numeric(6,2),
  ADD COLUMN IF NOT EXISTS differential_stddev      numeric(6,2),
  ADD COLUMN IF NOT EXISTS differential_sample_size integer NOT NULL DEFAULT 0,
  -- Recency-weighted effective sample (Σw)²/Σw² — drives the handicap-anchor
  -- blend and profile confidence.
  ADD COLUMN IF NOT EXISTS differential_effective_n numeric(6,2);

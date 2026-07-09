-- ============================================================
-- Fantasy Picks — profile model version.
--
-- Profiles were only rebuilt on a 24h TTL, so a model change (e.g. moving to
-- score differentials) left existing rows pricing off the OLD model until they
-- aged out — the differential fields stayed null and the sim silently used the
-- gross-average fallback. `model_version` lets ensureProfiles treat any row
-- built under an older PROFILE_MODEL_VERSION as stale and rebuild it on next
-- access. Default 0 → every existing row rebuilds on first touch.
-- ============================================================

ALTER TABLE public.fantasy_player_profiles
  ADD COLUMN IF NOT EXISTS model_version integer NOT NULL DEFAULT 0;

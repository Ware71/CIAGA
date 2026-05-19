-- ============================================================
-- Fix stableford competition leaderboard data issues:
--
-- 1. Backfill competition_tee_times.round_id for any old rows
--    where it is NULL (created before round_id was tracked).
--    Uses the back-link on rounds as source of truth.
--
-- 2. Fix competitions with competition_type = 'stableford' that
--    still have scoring_model != 'stableford_points' due to the
--    frontend bug fixed in a5c3c59.
--
-- 3. Recompute leaderboards for all stableford competitions so
--    they reflect the corrected scoring model.
-- ============================================================

-- 1. Backfill competition_tee_times.round_id from the back-link
--    on rounds where it is currently NULL.
UPDATE competition_tee_times ctt
SET round_id = r.id
FROM rounds r
WHERE r.competition_tee_time_id = ctt.id
  AND ctt.round_id IS NULL;

-- 2. Ensure all stableford competitions use stableford_points scoring.
UPDATE competitions
SET scoring_model = 'stableford_points'
WHERE competition_type = 'stableford'
  AND scoring_model != 'stableford_points';

-- 3. Recompute leaderboards for all stableford competitions.
DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM competitions WHERE competition_type = 'stableford'
  LOOP
    PERFORM ciaga_compute_competition_leaderboard(v_id);
  END LOOP;
END;
$$;

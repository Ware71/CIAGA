-- ============================================================
-- Backfill missing competition_round_submissions for finished
-- stableford competition rounds.
--
-- Root cause: rounds finished before auto-submit was introduced
-- (d0a4087) were never submitted to the competition, so
-- ciaga_compute_competition_leaderboard finds no accepted
-- submissions and produces an empty leaderboard even after
-- the scoring_model fix in 20260519000009.
--
-- Uses competition_tee_times.round_id (the reliable FK direction)
-- to find all finished rounds belonging to stableford competitions
-- and inserts accepted submissions for any participant that does
-- not already have one.
--
-- score_used is NULL because stab_pts in the leaderboard function
-- recomputes points directly from round_score_events — the
-- submission only needs to exist with accepted = true.
--
-- Then recomputes leaderboards for all stableford competitions
-- (same as 20260519000009 step 3, but now with submissions present).
-- ============================================================

INSERT INTO competition_round_submissions
  (competition_id, competition_round_id, round_id, profile_id,
   score_used, accepted, submitted_at)
SELECT
  ctt.competition_id,
  ctt.competition_round_id,
  r.id              AS round_id,
  rp.profile_id,
  NULL              AS score_used,   -- stableford: points computed from round_score_events
  true              AS accepted,
  NOW()             AS submitted_at
FROM competition_tee_times ctt
JOIN rounds r
  ON r.id = ctt.round_id
  AND r.status = 'finished'
JOIN competitions c
  ON c.id = ctt.competition_id
  AND c.competition_type = 'stableford'
JOIN round_participants rp
  ON rp.round_id = r.id
  AND rp.is_guest = false
  AND rp.profile_id IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM competition_round_submissions crs
  WHERE crs.competition_id = ctt.competition_id
    AND crs.round_id       = r.id
    AND crs.profile_id     = rp.profile_id
)
ON CONFLICT (competition_id, round_id, profile_id) DO NOTHING;

-- Recompute leaderboards now that submissions exist.
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

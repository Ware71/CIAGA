-- ============================================================
-- Backfill: recompute all stableford event leaderboards so that
-- existing entries pick up the new gross/net/course_par/to_par
-- values from ciaga_compute_event_leaderboard.
-- ============================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT e.id
    FROM events e
    JOIN event_round_submissions s ON s.event_id = e.id AND s.accepted = true
    WHERE e.scoring_model = 'stableford_points'
  LOOP
    BEGIN
      PERFORM ciaga_compute_event_leaderboard(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill stableford leaderboard failed for event %: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;

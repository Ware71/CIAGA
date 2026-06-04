-- ============================================================
-- Backfill round_participants.tee_snapshot_id for stableford
-- competition round participants where it is NULL.
--
-- Root cause: the tee-time join API (self-select flow) and any
-- other path that adds a participant to an already-live round
-- inserted round_participants without tee_snapshot_id. The
-- round start API only assigns tee_snapshot_id for participants
-- present at start time and returns early for live rounds.
--
-- Impact: the stableford pts computation does
--   JOIN round_tee_snapshots rts2 ON rts2.id = rp.tee_snapshot_id
-- inside a LEFT JOIN LATERAL. When tee_snapshot_id IS NULL the
-- INNER JOIN inside the lateral returns 0 rows → COALESCE(SUM, 0)
-- → the player's stableford points are always 0.
--
-- Fix: for each affected participant choose the round_tee_snapshots
-- row whose source_tee_box_id best matches their tee preference:
--   1. participant's pending_tee_box_id (per-player override)
--   2. round's pending_tee_box_id (competition default)
--   3. any snapshot for that round (safe fallback when only one exists)
-- ============================================================

UPDATE round_participants rp
SET tee_snapshot_id = (
  SELECT rts.id
  FROM round_course_snapshots rcs
  JOIN round_tee_snapshots rts ON rts.round_course_snapshot_id = rcs.id
  JOIN rounds r ON r.id = rcs.round_id
  WHERE rcs.round_id = rp.round_id
  ORDER BY
    CASE
      WHEN rts.source_tee_box_id =
           COALESCE(rp.pending_tee_box_id, r.pending_tee_box_id)
      THEN 0
      ELSE 1
    END,
    rts.created_at ASC
  LIMIT 1
)
WHERE rp.tee_snapshot_id IS NULL
  AND rp.is_guest = false
  AND rp.profile_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM competition_tee_times ctt
    JOIN competitions c ON c.id = ctt.competition_id
    WHERE ctt.round_id = rp.round_id
      AND c.competition_type = 'stableford'
  );

-- Recompute all stableford leaderboards so corrected tee_snapshot_ids
-- flow through to the stableford points calculation immediately.
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

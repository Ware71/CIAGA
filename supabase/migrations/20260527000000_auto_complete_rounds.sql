-- Function: ciaga_get_rounds_for_auto_complete
--
-- Returns all live rounds whose auto-complete threshold has elapsed.
-- Called by the /api/cron/auto-complete-rounds endpoint (runs every 15 min).
--
-- Algorithm:
--   completion_ratio = holes_done / (number_of_holes × participant_count)
--   threshold_hours  = 1 + (1 − completion_ratio) × 23   [1h → 24h]
--   auto-complete when: now − last_activity ≥ threshold_hours
--
-- "last_activity" is the latest of:
--   - any round_score_events.created_at for the round
--   - any round_hole_states.updated_at for the round
--   - rounds.started_at (fallback — always set for live rounds)

CREATE OR REPLACE FUNCTION public.ciaga_get_rounds_for_auto_complete()
RETURNS TABLE (
  round_id          uuid,
  completion_ratio  numeric,
  last_activity_at  timestamptz,
  threshold_hours   numeric,
  owner_profile_id  uuid
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH
  -- All live rounds
  live_rounds AS (
    SELECT id, created_by AS owner_profile_id, started_at, number_of_holes
    FROM rounds
    WHERE status = 'live'
      AND started_at IS NOT NULL
  ),

  -- Participant count per round
  participant_counts AS (
    SELECT round_id, COUNT(*)::numeric AS participant_count
    FROM round_participants
    WHERE round_id IN (SELECT id FROM live_rounds)
    GROUP BY round_id
  ),

  -- Completed/picked_up holes per round
  completed_hole_counts AS (
    SELECT round_id, COUNT(*)::numeric AS completed_count
    FROM round_hole_states
    WHERE round_id IN (SELECT id FROM live_rounds)
      AND status IN ('completed', 'picked_up')
    GROUP BY round_id
  ),

  -- Most recent score event per round
  latest_score_events AS (
    SELECT round_id, MAX(created_at) AS latest_score_at
    FROM round_score_events
    WHERE round_id IN (SELECT id FROM live_rounds)
    GROUP BY round_id
  ),

  -- Most recent hole state update per round
  latest_hole_updates AS (
    SELECT round_id, MAX(updated_at) AS latest_hole_at
    FROM round_hole_states
    WHERE round_id IN (SELECT id FROM live_rounds)
    GROUP BY round_id
  ),

  -- Assemble stats and compute ratio/threshold
  computed AS (
    SELECT
      lr.id                                                              AS round_id,
      lr.owner_profile_id,
      -- Last activity: max of started_at, latest score, latest hole update
      GREATEST(lr.started_at, ls.latest_score_at, lh.latest_hole_at)   AS last_activity_at,
      -- Completion ratio clamped to [0, 1]
      CASE
        WHEN COALESCE(pc.participant_count, 0) = 0
          OR COALESCE(lr.number_of_holes, 0) = 0
        THEN 0::numeric
        ELSE LEAST(
          COALESCE(ch.completed_count, 0)
            / (lr.number_of_holes::numeric * pc.participant_count),
          1.0
        )
      END                                                                AS completion_ratio
    FROM live_rounds lr
    LEFT JOIN participant_counts    pc ON pc.round_id = lr.id
    LEFT JOIN completed_hole_counts ch ON ch.round_id = lr.id
    LEFT JOIN latest_score_events   ls ON ls.round_id = lr.id
    LEFT JOIN latest_hole_updates   lh ON lh.round_id = lr.id
  )

  -- Return only rounds that have passed their threshold
  SELECT
    round_id,
    completion_ratio,
    last_activity_at,
    1.0 + (1.0 - completion_ratio) * 23.0                              AS threshold_hours,
    owner_profile_id
  FROM computed
  WHERE last_activity_at IS NOT NULL
    AND NOW() >= last_activity_at
                + ((1.0 + (1.0 - completion_ratio) * 23.0) * INTERVAL '1 hour');
$$;

-- Performance Phase 1: targeted indexes for feed top-comment and round scoring views.

-- 1. Top-comment lookup: getTopComments() orders by (vote_count DESC, created_at DESC)
--    within a set of feed_item_ids.  Existing index covers (feed_item_id, created_at)
--    but not the vote_count sort, forcing an in-memory sort per item.
CREATE INDEX IF NOT EXISTS idx_feed_comments_top
  ON public.feed_comments (feed_item_id, vote_count DESC, created_at DESC);

-- 2. round_current_scores view uses:
--      DISTINCT ON (round_id, participant_id, hole_number)
--      ORDER BY round_id, participant_id, hole_number, created_at DESC, id DESC
--    Existing indexes cover (participant_id, hole_number, created_at DESC) and
--    (round_id, created_at DESC), but neither matches the full DISTINCT ON key.
CREATE INDEX IF NOT EXISTS idx_round_score_events_latest
  ON public.round_score_events (round_id, participant_id, hole_number, created_at DESC, id DESC);

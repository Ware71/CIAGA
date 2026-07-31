-- Notification delivery intelligence — push throttling + catch-up digest.
-- See docs/notifications.md §7.
--
-- Until now createNotification fired a device push on EVERY write, including
-- merges into a grouped row. A post with 40 reactions was 40 buzzes even though
-- the in-app card collapsed correctly. These two columns are what let the push
-- decision consider cooldown, a rolling-hour budget and quiet hours.
--
--   last_pushed_at — stamped when a real INDIVIDUAL push is sent for this row.
--                    Serves all three gates: the per-group cooldown compares it
--                    against now(), the rolling-hour budget counts rows with it
--                    inside the last hour, and digest eligibility is IS NULL.
--
--   digested_at    — stamped when a row is covered by the 08:00 catch-up digest.
--
-- The second column is NOT redundant. The digest stamps many rows at a single
-- instant; if it wrote last_pushed_at those rows would read as N pushes in the
-- budget window and silence the user for the hour after every digest — the
-- machinery would throttle itself. Keeping them separate means the budget
-- counts only genuine individual pushes.

ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS last_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS digested_at    timestamptz;

COMMENT ON COLUMN public.user_notifications.last_pushed_at IS
  'When an individual Web Push was last sent for this row. NULL = never pushed (muted, throttled, or held for the digest).';
COMMENT ON COLUMN public.user_notifications.digested_at IS
  'When this row was included in an 08:00 catch-up digest push. Kept separate from last_pushed_at so a digest does not consume the rolling-hour push budget.';

-- Rolling-hour budget count: "how many pushes has this profile had since X".
CREATE INDEX IF NOT EXISTS idx_user_notifications_last_pushed
  ON public.user_notifications (profile_id, last_pushed_at)
  WHERE last_pushed_at IS NOT NULL;

-- Digest candidate scan: unread, never pushed, never digested.
CREATE INDEX IF NOT EXISTS idx_user_notifications_digest_pending
  ON public.user_notifications (profile_id, created_at)
  WHERE last_pushed_at IS NULL AND digested_at IS NULL AND read = false;

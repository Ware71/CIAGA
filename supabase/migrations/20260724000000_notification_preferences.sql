-- Per-category push notification preferences + entry-closing notification stamp
--
-- 1. notification_preferences — which notification categories a user has muted.
--    Muting suppresses PUSH DELIVERY ONLY: the in-app notification row is still
--    written and still counts toward the unread badge, so nothing is lost.
--    An absent row means nothing is muted (the default for every user).
--
--    Category keys are defined in apps/app/lib/notifications/preferences.ts and
--    map to the notification types in apps/app/lib/notifications/render.ts:
--      events     — event_created, entry_open, entry_closing
--      tee_times  — tee_time_assigned, tee_time_reminder, waitlist_offered
--      rounds     — round_scheduled, round_schedule_changed, round_cancelled
--      following  — follow_round_started, follow_round_completed
--      mentions   — mention_post, mention_comment
--      fantasy    — fantasy_pick_*, fantasy_parlay_*
--
-- 2. events.entry_closing_notified_at — so the entry-closing sweep sends once
--    per event (mirrors entry_open_notified_at).

-- ── 1. notification_preferences ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  profile_id       uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_categories text[]      NOT NULL DEFAULT '{}',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Owner (via profiles.owner_user_id) or service_role manage their own row.
-- Mirrors the push_subscriptions policies in
-- 20260625000001_notifications_push_announcements.sql.
CREATE POLICY "notification_preferences_select" ON public.notification_preferences
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "notification_preferences_insert" ON public.notification_preferences
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "notification_preferences_update" ON public.notification_preferences
  FOR UPDATE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "notification_preferences_delete" ON public.notification_preferences
  FOR DELETE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

-- ── 2. events: entry-closing notification stamp ──────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS entry_closing_notified_at timestamptz;

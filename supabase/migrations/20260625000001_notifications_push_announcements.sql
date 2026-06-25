-- Notifications expansion + Web Push + Announcements / first-run onboarding
--
-- 1. Extend user_notifications for grouped (aggregated) notifications + realtime
-- 2. push_subscriptions   — Web Push (VAPID) endpoints per profile/device
-- 3. events.entry_open_notified_at — so the entry-open cron sends once per event
-- 4. announcements + announcement_views — admin-authored info/promo/onboarding,
--    shown once per user
--
-- New notification types (type is free text — no enum to change):
--   event_created           { event_id, event_name, group_id, group_name }
--   entry_open              { event_id, event_name, group_id, group_name, entry_window_end }
--   mention_post            { feed_item_id, actor_profile_id, actor_name, excerpt }
--   mention_comment         { feed_item_id, comment_id, actor_profile_id, actor_name, excerpt }
--   follow_round_started    { actors:[{profile_id,name}], count, date }              (grouped)
--   follow_round_completed  { actors:[{profile_id,name,course_record?,course_name?}], count, date } (grouped)

-- ── 1. user_notifications: grouping + realtime ───────────────────────────────

ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS group_key  text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Fast lookup of the existing grouped (unread) row to merge into.
CREATE INDEX IF NOT EXISTS idx_user_notifications_group
  ON public.user_notifications(profile_id, group_key, read)
  WHERE group_key IS NOT NULL;

-- Enable realtime so the notification bell updates live. Guarded so re-running
-- the migration (or a table already in the publication) does not error.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already a member
  WHEN undefined_object THEN NULL;  -- publication not present (e.g. local without realtime)
END $$;

-- ── 2. push_subscriptions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile
  ON public.push_subscriptions(profile_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Owner (via profiles.owner_user_id) or service_role manage their own rows.
CREATE POLICY "push_subscriptions_select" ON public.push_subscriptions
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "push_subscriptions_insert" ON public.push_subscriptions
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "push_subscriptions_update" ON public.push_subscriptions
  FOR UPDATE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "push_subscriptions_delete" ON public.push_subscriptions
  FOR DELETE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

-- ── 3. events: entry-open notification stamp ─────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS entry_open_notified_at timestamptz;

-- ── 4. announcements + announcement_views ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.announcements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text UNIQUE,
  kind                  text NOT NULL DEFAULT 'info',        -- onboarding | promo | info
  title                 text NOT NULL,
  body                  text,
  image_url             text,
  cta_label             text,
  cta_url               text,
  active                boolean NOT NULL DEFAULT true,
  priority              int NOT NULL DEFAULT 0,              -- higher shows first
  publish_at            timestamptz,
  expires_at            timestamptz,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON public.announcements(active, priority DESC, created_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read announcements (the modal filters to
-- active + within publish/expiry window in the query layer); writes go through
-- the admin API (service_role).
CREATE POLICY "announcements_select" ON public.announcements
  FOR SELECT USING (auth.uid() IS NOT NULL OR auth.role() = 'service_role');

CREATE POLICY "announcements_write" ON public.announcements
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.announcement_views (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seen_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_views_profile
  ON public.announcement_views(profile_id);

ALTER TABLE public.announcement_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcement_views_select" ON public.announcement_views
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "announcement_views_insert" ON public.announcement_views
  FOR INSERT WITH CHECK (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

-- ── Seed the first-run onboarding announcement ───────────────────────────────
-- The onboarding modal renders structured steps (nav tutorial + permission
-- priming) in code; this row just gives it a stable id + once-per-user gating
-- via announcement_views.
INSERT INTO public.announcements (slug, kind, title, body, active, priority)
VALUES (
  'welcome-onboarding',
  'onboarding',
  'Welcome to CIAGA Golf',
  'Get set up: learn the basics and enable notifications & location.',
  true,
  1000
)
ON CONFLICT (slug) DO NOTHING;

-- User notifications for Majors events:
--   tee_time_assigned   — player has been placed in a tee time group
--   tee_time_reminder   — reminder before upcoming tee time
--   waitlist_offered    — player has been offered a competition spot from the waitlist
--
-- payload is a JSONB blob. Each notification type has a documented shape:
--   tee_time_assigned:  { competition_id, competition_name, tee_time, group_number }
--   tee_time_reminder:  { competition_id, competition_name, tee_time, round_id }
--   waitlist_offered:   { competition_id, competition_name, offer_expires_at }

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_profile_unread
  ON public.user_notifications(profile_id, read, created_at DESC);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see and update their own notifications
CREATE POLICY "notifications_select" ON public.user_notifications
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "notifications_update" ON public.user_notifications
  FOR UPDATE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

CREATE POLICY "notifications_insert" ON public.user_notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR auth.role() = 'service_role');

CREATE POLICY "notifications_delete" ON public.user_notifications
  FOR DELETE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

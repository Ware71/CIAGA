-- Event invitations — mirrors the group-invite flow (major_group_memberships
-- with status='invited') but as a separate table, so that event-entry side
-- effects (handicap snapshot, charges, pots) only fire when the invite is
-- accepted (i.e. on actual entry), never at invite time.

CREATE TABLE IF NOT EXISTS public.event_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'invited',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_event_invitations_profile
  ON public.event_invitations(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_event_invitations_event
  ON public.event_invitations(event_id, status);

ALTER TABLE public.event_invitations ENABLE ROW LEVEL SECURITY;

-- All app reads/writes go through the service role (supabaseAdmin), which
-- bypasses RLS. This policy only allows an invitee to read their own pending
-- invites if the table is ever queried directly from the client.
CREATE POLICY "event_invitations: read own"
  ON public.event_invitations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = event_invitations.profile_id
        AND p.owner_user_id = auth.uid()
    )
  );

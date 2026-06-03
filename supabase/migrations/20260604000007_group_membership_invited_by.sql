-- Add invited_by to track who sent the invitation
ALTER TABLE public.major_group_memberships
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Allow users to see their own invitations (even before they're active members)
CREATE POLICY "major_group_memberships: read own invite"
  ON public.major_group_memberships
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = major_group_memberships.profile_id
        AND p.owner_user_id = auth.uid()
    )
  );

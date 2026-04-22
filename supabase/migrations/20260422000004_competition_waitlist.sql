-- Competition waitlist: players can join when a competition is full or entry is closed.
-- On withdrawal, the next 'waiting' entrant is promoted to 'offered' and has 48h to enter.

CREATE TABLE IF NOT EXISTS public.competition_waitlist (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES public.profiles(id),
  status         text NOT NULL DEFAULT 'waiting'
                   CHECK (status IN ('waiting', 'offered', 'expired', 'joined')),
  offered_at     timestamptz,   -- set when status → offered
  joined_at      timestamptz,   -- set when status → joined
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_competition_status
  ON public.competition_waitlist(competition_id, status, created_at);

ALTER TABLE public.competition_waitlist ENABLE ROW LEVEL SECURITY;

-- Players can see their own waitlist entry; admins/owners see all
CREATE POLICY "waitlist_select" ON public.competition_waitlist
  FOR SELECT USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.uid() IN (
      SELECT p.owner_user_id FROM public.profiles p
      JOIN public.major_group_memberships m ON m.profile_id = p.id
      JOIN public.competitions c ON c.group_id = m.group_id
      WHERE c.id = competition_waitlist.competition_id
        AND m.role IN ('owner', 'admin')
        AND m.status = 'active'
    )
    OR auth.role() = 'service_role'
  );

CREATE POLICY "waitlist_insert" ON public.competition_waitlist
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "waitlist_update" ON public.competition_waitlist
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "waitlist_delete" ON public.competition_waitlist
  FOR DELETE USING (
    auth.uid() = (SELECT owner_user_id FROM public.profiles WHERE id = profile_id)
    OR auth.role() = 'service_role'
  );

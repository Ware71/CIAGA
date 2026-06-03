-- Standalone group-level charges not tied to any event or season.
-- These appear in the event join drawer for players who haven't been billed yet.

CREATE TABLE public.group_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount decimal(10,2) NOT NULL CHECK (amount > 0),
  description text,
  category text NOT NULL DEFAULT 'other',
  is_mandatory boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.group_charges ENABLE ROW LEVEL SECURITY;

-- Members can read active group charges for groups they belong to
CREATE POLICY "group_charges_select" ON public.group_charges
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships mgm
      WHERE mgm.group_id = group_charges.group_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
    )
  );

-- Only owners and admins can manage group charges
CREATE POLICY "group_charges_insert" ON public.group_charges
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships mgm
      WHERE mgm.group_id = group_charges.group_id
        AND mgm.profile_id = auth.uid()
        AND mgm.role IN ('owner', 'admin')
        AND mgm.status = 'active'
    )
  );

CREATE POLICY "group_charges_update" ON public.group_charges
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships mgm
      WHERE mgm.group_id = group_charges.group_id
        AND mgm.profile_id = auth.uid()
        AND mgm.role IN ('owner', 'admin')
        AND mgm.status = 'active'
    )
  );

CREATE POLICY "group_charges_delete" ON public.group_charges
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships mgm
      WHERE mgm.group_id = group_charges.group_id
        AND mgm.profile_id = auth.uid()
        AND mgm.role IN ('owner', 'admin')
        AND mgm.status = 'active'
    )
  );

CREATE INDEX group_charges_group_id_idx ON public.group_charges (group_id);

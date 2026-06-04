-- Group seasons: multiple named time windows per group
CREATE TABLE public.group_seasons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  name        text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'upcoming',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.group_seasons ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_group_seasons_group ON public.group_seasons(group_id);

CREATE POLICY "Group members can read seasons"
  ON public.group_seasons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships m
      WHERE m.group_id = group_seasons.group_id
        AND m.profile_id = auth.uid()
        AND m.status = 'active'
    )
  );

CREATE POLICY "Group owner/admin can manage seasons"
  ON public.group_seasons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.major_group_memberships m
      WHERE m.group_id = group_seasons.group_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
        AND m.status = 'active'
    )
  );

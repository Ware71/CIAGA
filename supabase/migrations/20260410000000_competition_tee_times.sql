-- Competition tee times
-- Links scheduled rounds to a competition event. Each tee time holds up to 4 players
-- (stored as round_participants on the linked round).

CREATE TABLE IF NOT EXISTS public.competition_tee_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  round_id uuid REFERENCES rounds(id) ON DELETE SET NULL,
  tee_time timestamptz NOT NULL,
  group_number integer,
  notes text,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_competition_tee_times_competition
  ON public.competition_tee_times(competition_id);

CREATE INDEX idx_competition_tee_times_round
  ON public.competition_tee_times(round_id)
  WHERE round_id IS NOT NULL;

-- RLS
ALTER TABLE public.competition_tee_times ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view tee times (same visibility as competitions)
CREATE POLICY "tee_times_select"
  ON public.competition_tee_times
  FOR SELECT
  USING (true);

-- Authenticated users can insert (group admin check enforced in API layer)
CREATE POLICY "tee_times_insert"
  ON public.competition_tee_times
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Creator or service_role can delete
CREATE POLICY "tee_times_delete"
  ON public.competition_tee_times
  FOR DELETE
  USING (
    auth.uid() = (SELECT owner_user_id FROM profiles WHERE id = created_by)
    OR auth.role() = 'service_role'
  );

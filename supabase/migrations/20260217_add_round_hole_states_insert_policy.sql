-- Fix: round_hole_states has no INSERT policy.
-- The upsert in the client code needs INSERT permission for new rows.
-- The seed_round_hole_states trigger pre-seeds rows, but this is needed as safety net.

CREATE POLICY "round_hole_states: participant insert"
  ON public.round_hole_states
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_round_participant(round_id));

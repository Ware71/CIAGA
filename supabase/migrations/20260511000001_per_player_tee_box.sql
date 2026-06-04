-- Per-player tee box assignment
--
-- Adds pending_tee_box_id to round_participants so each player can be assigned
-- a different tee before the round starts. At round start, individual tee snapshots
-- are created per player (falling back to rounds.pending_tee_box_id if not set).
-- The ciaga_persist_playing_handicaps RPC already joins rts.id = rp.tee_snapshot_id
-- per participant, so WHS-correct course handicap calculation works automatically.

ALTER TABLE public.round_participants
  ADD COLUMN pending_tee_box_id uuid REFERENCES public.course_tee_boxes(id);

COMMENT ON COLUMN public.round_participants.pending_tee_box_id IS
  'Pre-start tee box override for this participant. NULL = use rounds.pending_tee_box_id.
   Resolved into tee_snapshot_id when the round is started.';

-- Add gender-specific default tee boxes to competition_rounds.
--
-- Admins can set a men's and women's default tee box per competition round.
-- These are used as pre-fills when creating tee times (admin can still override
-- per player) and as the auto-assigned tee when players self-select into a tee time.

ALTER TABLE public.competition_rounds
  ADD COLUMN IF NOT EXISTS default_tee_box_id_male   uuid REFERENCES public.course_tee_boxes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_tee_box_id_female uuid REFERENCES public.course_tee_boxes(id) ON DELETE SET NULL;

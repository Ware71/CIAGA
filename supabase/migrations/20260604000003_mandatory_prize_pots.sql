-- Add is_mandatory flag to prize_pots
-- Mandatory pots auto-enroll players when they join an event in the pot's scope

ALTER TABLE public.prize_pots
  ADD COLUMN is_mandatory boolean NOT NULL DEFAULT false;

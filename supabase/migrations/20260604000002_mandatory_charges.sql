-- Add is_mandatory flag to event_charges
-- Mandatory charges are automatically assigned to players when they join an event

ALTER TABLE public.event_charges
  ADD COLUMN is_mandatory boolean NOT NULL DEFAULT false;

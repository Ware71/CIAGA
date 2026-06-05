-- Add ciaga_formula and custom_formula to the event points model enum,
-- and add a points_config jsonb column for formula parameters.

ALTER TYPE public.event_points_model ADD VALUE IF NOT EXISTS 'ciaga_formula';
ALTER TYPE public.event_points_model ADD VALUE IF NOT EXISTS 'custom_formula';

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS points_config jsonb DEFAULT NULL;

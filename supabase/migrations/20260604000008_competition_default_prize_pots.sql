-- Add default prize pot templates to competitions
-- When a competition event is created, these defaults pre-populate the prize pot wizard step.
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS default_prize_pots jsonb;

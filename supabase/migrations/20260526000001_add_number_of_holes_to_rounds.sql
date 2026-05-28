-- Add number_of_holes to rounds (staging schema catch-up).
-- This column tracks how many holes are being played for a round (typically 9 or 18).
ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS number_of_holes integer;

-- Add 'scheduled' status to round_status enum
-- This allows rounds to be scheduled for future start times
-- Editing permissions: round name can be edited while status IN ('draft', 'scheduled')

-- Add 'scheduled' value to the enum
-- Position it logically between 'draft' and 'starting'
ALTER TYPE public.round_status ADD VALUE IF NOT EXISTS 'scheduled' AFTER 'draft';

-- Add comment documenting the status flow
COMMENT ON TYPE public.round_status IS
  'Round lifecycle: draft → scheduled (optional) → starting → live → finished.
   Round name editable while status IN (draft, scheduled).';

-- Note: scheduled_at column and its index are added in a later migration
-- (20260216023331_add_round_formats_playing_handicap_teams.sql)

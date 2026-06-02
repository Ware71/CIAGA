-- Add matchplay_knockout to major_group_type enum
-- (major_series was already applied in a prior migration)
ALTER TYPE public.major_group_type ADD VALUE IF NOT EXISTS 'matchplay_knockout';

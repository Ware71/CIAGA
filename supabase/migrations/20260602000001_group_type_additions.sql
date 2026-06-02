-- Add major_series (was in TS types but missing from DB enum) and
-- matchplay_knockout (new type for bracket-style matchplay groups)
ALTER TYPE public.major_group_type ADD VALUE IF NOT EXISTS 'major_series';
ALTER TYPE public.major_group_type ADD VALUE IF NOT EXISTS 'matchplay_knockout';

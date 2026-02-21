-- Format System Overhaul – Part 1: Enum additions
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a multi-statement
-- transaction that also references the new values, so the enum additions
-- live in their own migration file.

ALTER TYPE public.round_format_type ADD VALUE IF NOT EXISTS 'pairs_stableford';
ALTER TYPE public.playing_handicap_mode ADD VALUE IF NOT EXISTS 'compare_against_lowest';

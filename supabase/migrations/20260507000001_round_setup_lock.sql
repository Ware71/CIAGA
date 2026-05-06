-- Add setup_locked flag to rounds.
-- When true: all participants see read-only setup info + "Start Match" button.
-- When false (default): current behaviour — owner edits, non-owners read-only.
-- Competition rounds created via tee-time assignment default to true (set in API).

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS setup_locked boolean NOT NULL DEFAULT false;

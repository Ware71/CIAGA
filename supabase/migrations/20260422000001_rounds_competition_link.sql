-- Add competition_tee_time_id to rounds so we can identify
-- rounds that were created by a Majors tee-time assignment.
-- These rounds should not be deletable from the rounds page;
-- players must withdraw via the competition instead.

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS competition_tee_time_id uuid
    REFERENCES public.competition_tee_times(id) ON DELETE SET NULL;

-- Backfill from existing competition_tee_times records
UPDATE public.rounds r
SET competition_tee_time_id = ctt.id
FROM public.competition_tee_times ctt
WHERE ctt.round_id = r.id
  AND r.competition_tee_time_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rounds_competition_tee_time
  ON public.rounds(competition_tee_time_id)
  WHERE competition_tee_time_id IS NOT NULL;

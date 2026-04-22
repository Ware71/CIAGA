-- Link competition_tee_times to competition_rounds.
-- A tee time is played as part of a specific competition round (Round 1, Round 2, etc.).
-- This makes the round ownership explicit: the round belongs to the competition,
-- not to the individual. When the round finishes, scores are auto-submitted.

ALTER TABLE public.competition_tee_times
  ADD COLUMN IF NOT EXISTS competition_round_id uuid
    REFERENCES public.competition_rounds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ctt_competition_round
  ON public.competition_tee_times(competition_round_id)
  WHERE competition_round_id IS NOT NULL;

-- Backfill: for tee times on single-round competitions, link to that competition's
-- sole competition_round (if one exists).
UPDATE public.competition_tee_times ctt
SET competition_round_id = cr.id
FROM public.competition_rounds cr
WHERE cr.competition_id = ctt.competition_id
  AND ctt.competition_round_id IS NULL
  AND (
    SELECT COUNT(*) FROM public.competition_rounds
    WHERE competition_id = ctt.competition_id
  ) = 1;

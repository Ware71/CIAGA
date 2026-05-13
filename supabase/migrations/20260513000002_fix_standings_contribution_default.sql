-- Change column default so future competitions created via raw SQL also default to season
ALTER TABLE public.competitions
  ALTER COLUMN standings_contribution SET DEFAULT 'season';

-- Backfill: flip existing group competitions that still have the old default
UPDATE public.competitions
SET standings_contribution = 'season'
WHERE standings_contribution = 'event_only'
  AND group_id IS NOT NULL;

-- Recompute group standings for every group that now has completed season competitions
DO $$
DECLARE
  g_id uuid;
BEGIN
  FOR g_id IN
    SELECT DISTINCT group_id
    FROM public.competitions
    WHERE group_id IS NOT NULL
      AND majors_status = 'completed'
      AND standings_contribution IN ('season', 'both')
  LOOP
    PERFORM public.ciaga_compute_group_standings(g_id);
  END LOOP;
END;
$$;

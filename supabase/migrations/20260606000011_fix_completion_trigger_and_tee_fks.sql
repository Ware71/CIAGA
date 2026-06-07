-- Fix ciaga_on_competition_completed trigger function.
-- The old function referenced season_id + ciaga_compute_season_standings(),
-- both dropped in 20260603000001_remove_competition_seasons.sql.
-- Replace with group_season_id + ciaga_compute_group_season_standings().
CREATE OR REPLACE FUNCTION public.ciaga_on_competition_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.majors_status = 'completed'
     AND (OLD.majors_status IS DISTINCT FROM 'completed')
     AND NEW.standings_contribution IN ('season', 'both')
  THEN
    IF NEW.group_id IS NOT NULL THEN
      PERFORM ciaga_compute_group_standings(NEW.group_id);
    END IF;
    IF NEW.group_season_id IS NOT NULL THEN
      PERFORM ciaga_compute_group_season_standings(NEW.group_season_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Rename tee-box FK constraints on event_rounds so PostgREST can resolve the join.
-- When tee-box columns were added to competition_rounds (migration 20260515000001),
-- PostgreSQL auto-named the constraints after the old table name.
-- After the table rename to event_rounds, the API query uses the new names → join silently fails.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competition_rounds_default_tee_box_id_male_fkey'
    AND conrelid = 'public.event_rounds'::regclass
  ) THEN
    ALTER TABLE public.event_rounds
      RENAME CONSTRAINT competition_rounds_default_tee_box_id_male_fkey
      TO event_rounds_default_tee_box_id_male_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competition_rounds_default_tee_box_id_female_fkey'
    AND conrelid = 'public.event_rounds'::regclass
  ) THEN
    ALTER TABLE public.event_rounds
      RENAME CONSTRAINT competition_rounds_default_tee_box_id_female_fkey
      TO event_rounds_default_tee_box_id_female_fkey;
  END IF;
END $$;

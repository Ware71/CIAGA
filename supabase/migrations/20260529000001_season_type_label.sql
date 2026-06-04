-- ============================================================
-- Majors: flexible season model
-- Adds season_type (calendar_year | custom) and season_label
-- to competition_seasons, and relaxes the unique year constraint
-- so cross-year seasons (e.g. "25/26 Season") can be created.
-- ============================================================

-- 1. Add season_type column
ALTER TABLE public.competition_seasons
  ADD COLUMN IF NOT EXISTS season_type text NOT NULL DEFAULT 'calendar_year'
    CHECK (season_type IN ('calendar_year', 'custom'));

-- 2. Add season_label column (human-readable, e.g. "2025" or "25/26 Season")
ALTER TABLE public.competition_seasons
  ADD COLUMN IF NOT EXISTS season_label text;

-- 3. Back-fill season_label for existing rows from season_year
UPDATE public.competition_seasons
SET season_label = season_year::text
WHERE season_label IS NULL AND season_year IS NOT NULL;

-- 4. Make season_year nullable (cross-year seasons derive start year from start_date)
ALTER TABLE public.competition_seasons
  ALTER COLUMN season_year DROP NOT NULL;

-- 5. Drop the unique(competition_id, season_year) constraint.
--    The constraint was originally on (series_id, season_year), renamed when the table
--    was renamed. Drop whichever name exists.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.competition_seasons'::regclass
      AND contype = 'u'
      AND conname LIKE '%season_year%'
  LOOP
    EXECUTE format('ALTER TABLE public.competition_seasons DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

-- 6. Trigger function to auto-compute season_label when not provided
CREATE OR REPLACE FUNCTION public.ciaga_set_season_label()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  start_yr integer;
  end_yr   integer;
BEGIN
  -- Only auto-compute if label is blank
  IF NEW.season_label IS NOT NULL AND trim(NEW.season_label) <> '' THEN
    RETURN NEW;
  END IF;

  IF NEW.season_type = 'calendar_year' THEN
    NEW.season_label := COALESCE(NEW.season_year::text, to_char(NEW.start_date, 'YYYY'));

  ELSIF NEW.season_type = 'custom' THEN
    start_yr := EXTRACT(YEAR FROM NEW.start_date)::integer;
    end_yr   := EXTRACT(YEAR FROM NEW.end_date)::integer;

    IF start_yr IS NULL THEN
      NEW.season_label := COALESCE(NEW.season_year::text, 'Season');
    ELSIF end_yr IS NOT NULL AND end_yr <> start_yr THEN
      -- Cross-year: "25/26 Season"
      NEW.season_label := (start_yr % 100)::text || '/' || (end_yr % 100)::text || ' Season';
    ELSE
      NEW.season_label := start_yr::text || ' Season';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_season_label_before_insert_update
  BEFORE INSERT OR UPDATE ON public.competition_seasons
  FOR EACH ROW EXECUTE FUNCTION public.ciaga_set_season_label();

-- 7. Back-fill label for any rows that still have a null label after the update above
UPDATE public.competition_seasons
SET season_label = season_year::text
WHERE season_label IS NULL AND season_year IS NOT NULL;

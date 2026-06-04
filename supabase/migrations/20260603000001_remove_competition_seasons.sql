-- ============================================================
-- Remove competition_seasons as a concept.
--
-- The hierarchy collapses from:
--   Group → Group Season → Competition Season → Events
-- to:
--   Group → Group Season → Events (tagged with competition_id)
--
-- Competition-specific standings are derived by filtering
-- group_season_standings_entries via events.competition_id.
-- ============================================================

-- ── 1. Update ciaga_compute_event_leaderboard ─────────────────
-- Replace: reads season_id and calls ciaga_compute_season_standings
-- With:    reads group_season_id and calls ciaga_compute_group_season_standings
DO $$
DECLARE
  fn_rec  RECORD;
  fn_def  text;
  new_def text;
BEGIN
  FOR fn_rec IN
    SELECT p.oid
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'ciaga_compute_event_leaderboard'
  LOOP
    fn_def  := pg_get_functiondef(fn_rec.oid);
    new_def := fn_def;

    -- Replace season_id variable declaration with group_season_id
    new_def := replace(new_def, 'v_season_id      uuid;', 'v_group_season_id uuid;');

    -- Replace season_id in the SELECT … INTO
    new_def := replace(new_def, '    season_id,', '    group_season_id,');
    new_def := replace(new_def, '    v_scoring_model, v_num_rounds, v_group_id, v_season_id, v_contribution,',
                                '    v_scoring_model, v_num_rounds, v_group_id, v_group_season_id, v_contribution,');

    -- Replace the cascade block that calls ciaga_compute_season_standings
    new_def := replace(
      new_def,
      '  -- Cascade to season standings
  IF v_season_id IS NOT NULL AND v_contribution IN (''season'', ''both'') THEN
    PERFORM ciaga_compute_season_standings(v_season_id);
  END IF;',
      '  -- Cascade to group season standings
  IF v_group_season_id IS NOT NULL AND v_contribution IN (''season'', ''both'') THEN
    PERFORM ciaga_compute_group_season_standings(v_group_season_id);
  END IF;'
    );

    IF new_def != fn_def THEN
      EXECUTE new_def;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. Drop events.season_id ──────────────────────────────────
ALTER TABLE public.events
  DROP COLUMN IF EXISTS season_id;

-- ── 3. Update prize_pots: remove competition_season_id ────────
-- Drop the old constraint, remove the column, add updated constraint.
ALTER TABLE public.prize_pots
  DROP CONSTRAINT IF EXISTS prize_pots_exactly_one_scope;

ALTER TABLE public.prize_pots
  DROP COLUMN IF EXISTS competition_season_id;

DROP INDEX IF EXISTS idx_prize_pots_competition_season;

ALTER TABLE public.prize_pots
  ADD CONSTRAINT prize_pots_exactly_one_scope CHECK (
    (event_id IS NOT NULL)::int +
    (group_season_id IS NOT NULL)::int = 1
  );

-- ── 4. Drop season_standings_entries ─────────────────────────
DROP TABLE IF EXISTS public.season_standings_entries CASCADE;

-- ── 5. Drop competition_seasons ───────────────────────────────
-- Must come after season_standings_entries (CASCADE handles remaining FKs).
DROP TABLE IF EXISTS public.competition_seasons CASCADE;

-- ── 6. Drop ciaga_compute_season_standings ────────────────────
DROP FUNCTION IF EXISTS public.ciaga_compute_season_standings(uuid);

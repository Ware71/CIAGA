-- ============================================================
-- RENAME: Competition (single instance) → Event
--         Series   (recurring template) → Competition
--
-- Mapping:
--   competitions table          → events
--   competition_series table    → competitions
--   competition_* child tables  → event_*
--   series_event_templates      → competition_event_templates
--   series_seasons              → competition_seasons
--   competition_id FK           → event_id
--   series_id FK                → competition_id
-- ============================================================

-- ─── Step 1: Rename single-instance (event) tables ──────────
ALTER TABLE public.competitions                    RENAME TO events;
ALTER TABLE public.competition_rounds              RENAME TO event_rounds;
ALTER TABLE public.competition_round_submissions   RENAME TO event_round_submissions;
ALTER TABLE public.competition_entries             RENAME TO event_entries;
ALTER TABLE public.competition_leaderboard_entries RENAME TO event_leaderboard_entries;
ALTER TABLE public.competition_tee_times           RENAME TO event_tee_times;
ALTER TABLE public.competition_rules_versions      RENAME TO event_rules_versions;
ALTER TABLE public.competition_extras              RENAME TO event_extras;
ALTER TABLE public.competition_winnings            RENAME TO event_winnings;
ALTER TABLE public.competition_waitlist            RENAME TO event_waitlist;
ALTER TABLE public.competition_audit_log           RENAME TO event_audit_log;
ALTER TABLE public.competition_player_freeze_snapshots RENAME TO event_player_freeze_snapshots;
ALTER TABLE public.profile_competition_stats       RENAME TO profile_event_stats;

-- ─── Step 2: Rename series/template tables ───────────────────
ALTER TABLE public.competition_series    RENAME TO competitions;
ALTER TABLE public.series_event_templates RENAME TO competition_event_templates;
ALTER TABLE public.series_seasons        RENAME TO competition_seasons;

-- ─── Step 3: Rename columns on events table (was competitions) ─
ALTER TABLE public.events RENAME COLUMN series_id                  TO competition_id;
ALTER TABLE public.events RENAME COLUMN series_event_template_id   TO competition_event_template_id;
ALTER TABLE public.events RENAME COLUMN competition_type           TO event_type;
ALTER TABLE public.events RENAME COLUMN competition_date           TO event_date;
ALTER TABLE public.events RENAME COLUMN competition_year           TO event_year;
ALTER TABLE public.events RENAME COLUMN competition_category       TO event_category;
ALTER TABLE public.events RENAME COLUMN competition_structure      TO event_structure;

-- ─── Step 4: Rename competition_id → event_id on child event tables ─
ALTER TABLE public.event_rounds              RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_round_submissions   RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_round_submissions   RENAME COLUMN competition_round_id  TO event_round_id;
ALTER TABLE public.event_entries             RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_leaderboard_entries RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_tee_times           RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_tee_times           RENAME COLUMN competition_round_id  TO event_round_id;
ALTER TABLE public.event_rules_versions      RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_rules_versions      RENAME COLUMN competition_format    TO event_format;
ALTER TABLE public.event_rules_versions      RENAME COLUMN competition_structure TO event_structure;
ALTER TABLE public.event_extras              RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_winnings            RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_waitlist            RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_audit_log           RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_player_freeze_snapshots RENAME COLUMN competition_id   TO event_id;
ALTER TABLE public.profile_event_stats       RENAME COLUMN series_id            TO competition_id;
ALTER TABLE public.event_history_summaries   RENAME COLUMN competition_id        TO event_id;
ALTER TABLE public.event_history_summaries   RENAME COLUMN series_event_template_id TO competition_event_template_id;

-- ─── Step 5: Rename on matchplay + shared tables ─────────────
ALTER TABLE public.matchplay_stages              RENAME COLUMN competition_id TO event_id;
ALTER TABLE public.matchplay_fixtures            RENAME COLUMN competition_id TO event_id;
ALTER TABLE public.matchplay_bracket_slots       RENAME COLUMN competition_id TO event_id;
ALTER TABLE public.matchplay_league_table_entries RENAME COLUMN competition_id TO event_id;
ALTER TABLE public.group_balance_transactions    RENAME COLUMN competition_id      TO event_id;
ALTER TABLE public.group_balance_transactions    RENAME COLUMN competition_extra_id TO event_extra_id;
ALTER TABLE public.rounds                        RENAME COLUMN competition_tee_time_id TO event_tee_time_id;

-- ─── Step 6: Rename columns on competitions + sub-tables ─────
ALTER TABLE public.competition_event_templates RENAME COLUMN series_id TO competition_id;
ALTER TABLE public.competition_event_templates RENAME COLUMN template_competition_type TO template_event_type;
ALTER TABLE public.competition_seasons         RENAME COLUMN series_id TO competition_id;
ALTER TABLE public.competitions                RENAME COLUMN template_competition_type     TO template_event_type;
ALTER TABLE public.competitions                RENAME COLUMN template_competition_category TO template_event_category;
ALTER TABLE public.competitions                RENAME COLUMN series_type                   TO competition_type;

-- ─── Step 7: Rename enum types ───────────────────────────────
ALTER TYPE public.competition_type_v2       RENAME TO event_type_v2;
ALTER TYPE public.competition_scoring_model RENAME TO event_scoring_model;
ALTER TYPE public.competition_points_model  RENAME TO event_points_model;
ALTER TYPE public.competition_majors_status RENAME TO event_status;
ALTER TYPE public.competition_structure     RENAME TO event_structure;
ALTER TYPE public.competition_category      RENAME TO event_category;
ALTER TYPE public.series_type               RENAME TO competition_type;

-- ─── Step 8: Update all stored function bodies ───────────────
-- Uses pg_get_functiondef text-substitution so we always operate on
-- the current stored version, regardless of which migration last touched it.
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
      AND (
           p.prosrc LIKE '%competition%'
        OR p.prosrc LIKE '%series_season%'
        OR p.prosrc LIKE '%series_event%'
        OR p.prosrc LIKE '%profile_competition%'
      )
  LOOP
    fn_def  := pg_get_functiondef(fn_rec.oid);
    new_def := fn_def;

    -- ── Table renames (most specific first) ─────────────────────────
    new_def := replace(new_def, 'competition_round_submissions',     'event_round_submissions');
    new_def := replace(new_def, 'competition_leaderboard_entries',   'event_leaderboard_entries');
    new_def := replace(new_def, 'competition_tee_times',             'event_tee_times');
    new_def := replace(new_def, 'competition_rounds',                'event_rounds');
    new_def := replace(new_def, 'competition_audit_log',             'event_audit_log');
    new_def := replace(new_def, 'competition_player_freeze_snapshots', 'event_player_freeze_snapshots');
    new_def := replace(new_def, 'competition_rules_versions',        'event_rules_versions');
    new_def := replace(new_def, 'competition_extras',                'event_extras');
    new_def := replace(new_def, 'competition_winnings',              'event_winnings');
    new_def := replace(new_def, 'competition_waitlist',              'event_waitlist');
    new_def := replace(new_def, 'profile_competition_stats',         'profile_event_stats');
    new_def := replace(new_def, 'series_event_templates',            'competition_event_templates');
    new_def := replace(new_def, 'series_seasons',                    'competition_seasons');

    -- ── Column renames (most specific first) ─────────────────────────
    new_def := replace(new_def, 'series_event_template_id',      'competition_event_template_id');
    new_def := replace(new_def, 'competition_tee_time_id',        'event_tee_time_id');
    new_def := replace(new_def, 'competition_round_id',           'event_round_id');
    new_def := replace(new_def, 'template_competition_type',      'template_event_type');
    new_def := replace(new_def, 'template_competition_category',  'template_event_category');

    -- competition_id → event_id (FK to old single-instance table, now events)
    -- Must run BEFORE series_id → competition_id to avoid double-rename.
    new_def := replace(new_def, 'competition_id', 'event_id');

    -- series_id → competition_id (FK to old series template, now competitions)
    new_def := replace(new_def, 'series_id', 'competition_id');

    -- ── Table FROM/JOIN: competition_series → competitions (via sentinel) ─
    -- Sentinel prevents this "competitions" from being caught by the
    -- FROM competitions → FROM events substitution below.
    new_def := replace(new_def, 'competition_series', '_XSERIES_');

    -- FROM/JOIN competitions = old single-instance table → events
    new_def := replace(new_def, 'FROM competitions',   'FROM events');
    new_def := replace(new_def, 'JOIN competitions ',  'JOIN events ');
    new_def := replace(new_def, 'INTO competitions',   'INTO events');
    new_def := replace(new_def, 'UPDATE competitions', 'UPDATE events');

    -- Restore sentinel
    new_def := replace(new_def, '_XSERIES_', 'competitions');

    -- ── Column names on events table that need renaming ──────────────
    -- Use dot-qualified form to avoid false positives.
    new_def := replace(new_def, '.competition_type',      '.event_type');
    new_def := replace(new_def, '.competition_category',  '.event_category');
    new_def := replace(new_def, '.competition_structure', '.event_structure');
    new_def := replace(new_def, '.competition_date',      '.event_date');
    new_def := replace(new_def, '.competition_year',      '.event_year');
    new_def := replace(new_def, '.competition_format',    '.event_format');

    -- ── Function name references ──────────────────────────────────────
    -- Replacing the function name in the signature creates a NEW function
    -- with the new name; the old function is dropped in Step 9.
    new_def := replace(new_def, 'ciaga_compute_competition_leaderboard', 'ciaga_compute_event_leaderboard');
    new_def := replace(new_def, 'ciaga_lock_competition',   'ciaga_lock_event');
    new_def := replace(new_def, 'ciaga_unlock_competition', 'ciaga_unlock_event');

    IF new_def != fn_def THEN
      IF fn_def LIKE '%p_competition_id%' OR fn_def LIKE '%p_series_id%' THEN
        -- Input parameter is being renamed; DROP first (CREATE OR REPLACE cannot rename params).
        EXECUTE 'DROP FUNCTION IF EXISTS ' || fn_rec.oid::regprocedure::text;
        new_def := replace(new_def, 'CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
      END IF;
      EXECUTE new_def;
    END IF;
  END LOOP;
END;
$$;

-- ─── Step 9: Drop old function names (new ones created in Step 8) ──
DROP FUNCTION IF EXISTS public.ciaga_compute_competition_leaderboard(uuid);
DROP FUNCTION IF EXISTS public.ciaga_lock_competition(uuid);
DROP FUNCTION IF EXISTS public.ciaga_unlock_competition(uuid);

-- ─── Step 10: Update trigger on events table (was competitions) ─
-- The freeze trigger body references competition_id/competition columns
-- via NEW.* — no body change needed; it moves with the table rename.
-- Recreate the trigger name for clarity.
DROP TRIGGER IF EXISTS trg_on_competition_freeze ON public.events;
CREATE TRIGGER trg_on_event_freeze
  AFTER UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_freeze_state_change();

DROP TRIGGER IF EXISTS trg_competition_completed_cascade ON public.events;
CREATE TRIGGER trg_event_completed_cascade
  AFTER UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_competition_completed();

-- event_round_submissions trigger (moved with table, body updated in Step 8)
DROP TRIGGER IF EXISTS trg_submission_accepted_recompute ON public.event_round_submissions;
CREATE TRIGGER trg_submission_accepted_recompute
  AFTER INSERT OR UPDATE ON public.event_round_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.ciaga_on_submission_change();

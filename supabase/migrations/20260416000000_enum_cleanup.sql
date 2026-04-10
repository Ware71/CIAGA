-- ============================================================
-- Majors: Enum cleanup — remove legacy values
-- NOTE: Run this migration ONLY after verifying no rows use the
-- old enum values. Check with queries like:
--   SELECT DISTINCT competition_type FROM competitions;
--   SELECT DISTINCT type FROM major_groups;
--   SELECT DISTINCT majors_status FROM competitions;
--
-- PostgreSQL does not support DROP VALUE on enums directly.
-- The safe pattern is: create a new enum, migrate column, drop old.
-- ============================================================

-- ── 1. Normalize competition_type column ─────────────────────
-- Map legacy 'stroke' → 'stroke_play', 'bestball' → 'team_best_ball',
-- 'scramble' → 'team_scramble'. Other values remain as-is.
-- Only run if you have confirmed these legacy values are used and
-- you want to normalize them. Comment out if not ready.

-- UPDATE competitions SET competition_type = 'stroke_play'::competition_type_v2
--   WHERE competition_type = 'stroke';

-- UPDATE competitions SET competition_type = 'team_best_ball'::competition_type_v2
--   WHERE competition_type = 'bestball';

-- UPDATE competitions SET competition_type = 'team_scramble'::competition_type_v2
--   WHERE competition_type = 'scramble';

-- UPDATE competition_series SET template_competition_type = 'stroke_play'::competition_type_v2
--   WHERE template_competition_type = 'stroke';

-- ── 2. Normalize majors_status column ───────────────────────
-- Map 'upcoming' → 'published' (or 'entry_open' depending on context).
-- Comment out if not ready.

-- UPDATE competitions SET majors_status = 'published'::competition_majors_status
--   WHERE majors_status = 'upcoming';

-- ── 3. Remove old enum values ────────────────────────────────
-- This section is intentionally commented out.
-- It should be executed AFTER all application code has been updated
-- and data migration above is confirmed complete.
--
-- The pattern for removing enum values:
--   CREATE TYPE competition_type_v2_new AS ENUM (...new values only...);
--   ALTER TABLE competitions ALTER COLUMN competition_type
--     TYPE competition_type_v2_new USING competition_type::text::competition_type_v2_new;
--   DROP TYPE competition_type_v2;
--   ALTER TYPE competition_type_v2_new RENAME TO competition_type_v2;
--
-- Deferred to a future migration when legacy values confirmed unused.

-- ── Placeholder: mark this migration as applied ───────────────
SELECT 1 AS enum_cleanup_migration_applied;

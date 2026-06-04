-- ============================================================
-- Majors: Spec-aligned enum additions
-- Adds the four new enum types from the revised spec and
-- extends existing enums with new values.
-- All changes are purely additive — no existing values removed.
-- ============================================================

-- ── New enum: series_type ────────────────────────────────────
CREATE TYPE public.series_type AS ENUM (
  'tour',
  'major_series',
  'matchplay_league',
  'matchplay_knockout',
  'championship_series',
  'season'
);

-- ── New enum: competition_structure ─────────────────────────
CREATE TYPE public.competition_structure AS ENUM (
  'standalone',
  'multi_round',
  'season_event',
  'league_fixture',
  'knockout_match'
);

-- ── New enum: scoring_basis ──────────────────────────────────
CREATE TYPE public.scoring_basis AS ENUM (
  'gross',
  'net',
  'stableford_points',
  'match_result'
);

-- ── New enum: standings_model ────────────────────────────────
CREATE TYPE public.standings_model AS ENUM (
  'none',
  'season_points',
  'league_table',
  'knockout_progression'
);

-- ── Extend major_group_type with spec-aligned host group types ──
ALTER TYPE public.major_group_type ADD VALUE IF NOT EXISTS 'society';
ALTER TYPE public.major_group_type ADD VALUE IF NOT EXISTS 'friend_group';
ALTER TYPE public.major_group_type ADD VALUE IF NOT EXISTS 'major_series_host';
ALTER TYPE public.major_group_type ADD VALUE IF NOT EXISTS 'public_organizer';

-- ── Extend competition_majors_status with full lifecycle states ──
ALTER TYPE public.competition_majors_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.competition_majors_status ADD VALUE IF NOT EXISTS 'published';
ALTER TYPE public.competition_majors_status ADD VALUE IF NOT EXISTS 'entry_open';
ALTER TYPE public.competition_majors_status ADD VALUE IF NOT EXISTS 'entry_closed';
ALTER TYPE public.competition_majors_status ADD VALUE IF NOT EXISTS 'unofficial';
ALTER TYPE public.competition_majors_status ADD VALUE IF NOT EXISTS 'official';
ALTER TYPE public.competition_majors_status ADD VALUE IF NOT EXISTS 'archived';

-- ── Extend competition_type_v2 with spec-aligned format values ──
ALTER TYPE public.competition_type_v2 ADD VALUE IF NOT EXISTS 'stroke_play';
ALTER TYPE public.competition_type_v2 ADD VALUE IF NOT EXISTS 'matchplay_fixture';
ALTER TYPE public.competition_type_v2 ADD VALUE IF NOT EXISTS 'matchplay_knockout_match';
ALTER TYPE public.competition_type_v2 ADD VALUE IF NOT EXISTS 'aggregate_stroke_play';
ALTER TYPE public.competition_type_v2 ADD VALUE IF NOT EXISTS 'team_best_ball';
ALTER TYPE public.competition_type_v2 ADD VALUE IF NOT EXISTS 'team_scramble';

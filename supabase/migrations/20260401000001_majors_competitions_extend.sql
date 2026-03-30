-- CIAGA Majors: Extend competitions table with group linkage and full competition lifecycle fields
-- Preserves existing ciaga_lock_competition / ciaga_unlock_competition functions and competition_entries rows

-- New enum types for competitions
CREATE TYPE public.competition_type_v2 AS ENUM
  ('stroke', 'stableford', 'matchplay', 'skins', 'scramble', 'bestball', 'custom');

CREATE TYPE public.competition_scoring_model AS ENUM
  ('gross', 'net', 'stableford_points', 'match_result');

CREATE TYPE public.competition_points_model AS ENUM
  ('none', 'fedex_style', 'custom_table', 'position_based');

CREATE TYPE public.competition_majors_status AS ENUM
  ('upcoming', 'live', 'completed', 'cancelled');

-- Extend existing competitions table
ALTER TABLE public.competitions
  ADD COLUMN group_id               uuid REFERENCES public.major_groups(id) ON DELETE SET NULL,
  ADD COLUMN competition_type       public.competition_type_v2 NOT NULL DEFAULT 'stroke',
  ADD COLUMN format                 text,
  ADD COLUMN course_id              uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  ADD COLUMN competition_date       date,
  ADD COLUMN entry_window_start     timestamptz,
  ADD COLUMN entry_window_end       timestamptz,
  ADD COLUMN rules_text             text,
  ADD COLUMN scoring_model          public.competition_scoring_model NOT NULL DEFAULT 'net',
  ADD COLUMN points_model           public.competition_points_model NOT NULL DEFAULT 'none',
  ADD COLUMN points_table           jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN eligibility_rules      jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN handicap_rules         jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN num_rounds             integer NOT NULL DEFAULT 1,
  ADD COLUMN round_rules            jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN time_rules             jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN membership_rules       jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN standings_contribution text NOT NULL DEFAULT 'event_only'
    CHECK (standings_contribution IN ('event_only', 'season', 'both')),
  ADD COLUMN majors_status          public.competition_majors_status NOT NULL DEFAULT 'upcoming',
  ADD COLUMN created_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_competitions_group ON public.competitions(group_id);
CREATE INDEX idx_competitions_date ON public.competitions(competition_date);
CREATE INDEX idx_competitions_majors_status ON public.competitions(majors_status);

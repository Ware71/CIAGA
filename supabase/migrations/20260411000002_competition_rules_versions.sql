-- ============================================================
-- Majors: competition_rules_versions — frozen rules snapshots
-- Rules are snapshotted when a competition is published so
-- historical records remain immutable even if templates change.
-- ============================================================

-- ── competition_rules_versions table ─────────────────────────
CREATE TABLE public.competition_rules_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id           uuid REFERENCES public.competitions(id) ON DELETE CASCADE,
  source_template_id       uuid REFERENCES public.series_event_templates(id) ON DELETE SET NULL,
  rules_version            integer NOT NULL DEFAULT 1,
  competition_format       text NOT NULL,          -- mirrors competition_type_v2 value
  competition_structure    public.competition_structure NOT NULL DEFAULT 'standalone',
  scoring_basis            public.scoring_basis NOT NULL DEFAULT 'net',
  handicap_config          jsonb NOT NULL DEFAULT '{}',
  points_config            jsonb NOT NULL DEFAULT '{}',
  tie_break_config         jsonb NOT NULL DEFAULT '{}',
  eligibility_config       jsonb NOT NULL DEFAULT '{}',
  cut_config               jsonb,                  -- future multi-round support
  matchplay_config         jsonb,                  -- match length, allowance, playoff rules
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_crv_competition ON public.competition_rules_versions(competition_id);
CREATE INDEX idx_crv_source_template ON public.competition_rules_versions(source_template_id);

ALTER TABLE public.competition_rules_versions ENABLE ROW LEVEL SECURITY;

-- Readable by authenticated users (rules are not secret once published)
CREATE POLICY "competition_rules_versions_select"
  ON public.competition_rules_versions FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.competition_rules_versions TO authenticated;
GRANT ALL ON public.competition_rules_versions TO service_role;

-- ── Back-link: competitions.published_rules_version_id ───────
-- Added after the table exists to avoid circular FK issues.
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS published_rules_version_id uuid
    REFERENCES public.competition_rules_versions(id) ON DELETE SET NULL;

-- ── Back-link: series_seasons.standings_rules_version_id ─────
ALTER TABLE public.series_seasons
  ADD COLUMN IF NOT EXISTS standings_rules_version_id uuid
    REFERENCES public.competition_rules_versions(id) ON DELETE SET NULL;

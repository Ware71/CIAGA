-- ============================================================
-- Majors: series_seasons — year-scoped season instances
-- A season is one year's instance of a competition_series.
-- Competitions belonging to a season reference season_id.
-- ============================================================

-- ── series_seasons table ─────────────────────────────────────
CREATE TABLE public.series_seasons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id        uuid NOT NULL REFERENCES public.competition_series(id) ON DELETE CASCADE,
  season_year      integer NOT NULL,
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'live', 'completed', 'archived')),
  start_date       date,
  end_date         date,
  standings_model  public.standings_model NOT NULL DEFAULT 'none',
  -- standings_rules_version_id added after competition_rules_versions is created (migration 20260411000002)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(series_id, season_year)
);

CREATE INDEX idx_series_seasons_series ON public.series_seasons(series_id);
CREATE INDEX idx_series_seasons_year ON public.series_seasons(season_year);

ALTER TABLE public.series_seasons ENABLE ROW LEVEL SECURITY;

-- Members of the parent group (or public groups) can read
CREATE POLICY "series_seasons_select"
  ON public.series_seasons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.competition_series cs
      JOIN public.major_group_memberships mgm ON mgm.group_id = cs.group_id
      WHERE cs.id = series_seasons.series_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.competition_series cs
      JOIN public.major_groups mg ON mg.id = cs.group_id
      WHERE cs.id = series_seasons.series_id
        AND mg.privacy = 'public'
    )
  );

-- Only owner/admin can create
CREATE POLICY "series_seasons_insert"
  ON public.series_seasons FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.competition_series cs
      JOIN public.major_group_memberships mgm ON mgm.group_id = cs.group_id
      WHERE cs.id = series_seasons.series_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

-- Only owner/admin can update
CREATE POLICY "series_seasons_update"
  ON public.series_seasons FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.competition_series cs
      JOIN public.major_group_memberships mgm ON mgm.group_id = cs.group_id
      WHERE cs.id = series_seasons.series_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

GRANT SELECT ON public.series_seasons TO authenticated;
GRANT ALL ON public.series_seasons TO service_role;

-- ── Extend competitions with season linkage and spec columns ─
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS season_id             uuid REFERENCES public.series_seasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS competition_structure public.competition_structure NOT NULL DEFAULT 'standalone',
  ADD COLUMN IF NOT EXISTS scoring_basis         public.scoring_basis;

CREATE INDEX IF NOT EXISTS idx_competitions_season ON public.competitions(season_id);

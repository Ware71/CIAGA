-- ============================================================
-- Majors: series_type and metadata columns on competition_series
-- Adds the series_type enum column and supporting metadata so
-- series can declare their structural intent (tour, major_series,
-- matchplay_league, etc.)
-- ============================================================

ALTER TABLE public.competition_series
  ADD COLUMN IF NOT EXISTS series_type         public.series_type NOT NULL DEFAULT 'major_series',
  ADD COLUMN IF NOT EXISTS is_active           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_start_month integer CHECK (default_start_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS default_end_month   integer CHECK (default_end_month BETWEEN 1 AND 12);

-- Index for common filter (active series per group)
CREATE INDEX IF NOT EXISTS idx_competition_series_active
  ON public.competition_series(group_id, is_active);

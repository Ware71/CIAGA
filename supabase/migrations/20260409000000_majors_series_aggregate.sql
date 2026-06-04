-- ============================================================
-- Majors: Major Series group type, Competition Series (recurring),
-- and Competition Category (round_based / aggregate / standalone)
-- ============================================================

-- 1. Add major_series to the group type enum
ALTER TYPE major_group_type ADD VALUE IF NOT EXISTS 'major_series';

-- 2. New enum: competition category
CREATE TYPE competition_category AS ENUM ('round_based', 'aggregate', 'standalone');

-- 3. competition_series — template for annually recurring competitions
--    A series lives inside a major_group and defines the "brand" of a
--    competition that repeats each year (e.g. "The Club Masters").
--    Each year's instance is a normal competition row that points back
--    here via series_id.
CREATE TABLE competition_series (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                    uuid REFERENCES major_groups(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  description                 text,
  recur_annually              boolean NOT NULL DEFAULT true,
  typical_month               integer CHECK (typical_month BETWEEN 1 AND 12),
  -- Template defaults copied when creating a new year's instance
  template_competition_type   competition_type_v2 NOT NULL DEFAULT 'stroke',
  template_competition_category competition_category NOT NULL DEFAULT 'round_based',
  template_scoring_model      competition_scoring_model NOT NULL DEFAULT 'net',
  template_points_model       competition_points_model NOT NULL DEFAULT 'none',
  template_rules_text         text,
  template_settings           jsonb NOT NULL DEFAULT '{}',
  created_by_profile_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_competition_series_group ON competition_series(group_id);

-- RLS: members of the group can read series; owner/admin can write
ALTER TABLE competition_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competition_series_select"
  ON competition_series FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM major_group_memberships mgm
      WHERE mgm.group_id = competition_series.group_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
    )
    OR
    EXISTS (
      SELECT 1 FROM major_groups mg
      WHERE mg.id = competition_series.group_id
        AND mg.privacy = 'public'
    )
  );

CREATE POLICY "competition_series_insert"
  ON competition_series FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM major_group_memberships mgm
      WHERE mgm.group_id = competition_series.group_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "competition_series_update"
  ON competition_series FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM major_group_memberships mgm
      WHERE mgm.group_id = competition_series.group_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

-- 4. Extend competitions table with series linkage and category
ALTER TABLE competitions
  ADD COLUMN series_id            uuid REFERENCES competition_series(id) ON DELETE SET NULL,
  ADD COLUMN competition_year     integer,
  ADD COLUMN competition_category competition_category NOT NULL DEFAULT 'round_based',
  -- aggregate_config (jsonb) defines how non-round competitions are scored.
  -- Shape for 'aggregate' category:
  --   {
  --     "source": "group_standings" | "competition_ids" | "custom",
  --     "competition_ids": ["<uuid>", ...],   -- if source = competition_ids
  --     "top_n_events": 5,                    -- count only best N results
  --     "include_round": false                -- whether a physical round also scores
  --   }
  ADD COLUMN aggregate_config     jsonb NOT NULL DEFAULT '{}';

CREATE INDEX idx_competitions_series ON competitions(series_id);

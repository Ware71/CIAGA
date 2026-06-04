-- ============================================================
-- Series Event Templates
-- Adds named event "slots" within a series (e.g. "The Masters",
-- "US Open") so a single series can contain multiple recurring
-- events. Each event template spawns one competition per year.
-- ============================================================

-- 1. Named event templates within a series
CREATE TABLE IF NOT EXISTS series_event_templates (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id                 uuid NOT NULL REFERENCES competition_series(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  description               text,
  sort_order                integer NOT NULL DEFAULT 0,
  typical_month             integer CHECK (typical_month BETWEEN 1 AND 12),
  -- Override series-level defaults (null = inherit from series)
  template_competition_type competition_type_v2,
  template_scoring_model    competition_scoring_model,
  template_points_model     competition_points_model,
  template_rules_text       text,
  template_settings         jsonb NOT NULL DEFAULT '{}',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_series_event_templates_series ON series_event_templates(series_id);

-- 2. Optional num_rounds default on competition_series
ALTER TABLE competition_series
  ADD COLUMN IF NOT EXISTS template_num_rounds integer NOT NULL DEFAULT 1;

-- 3. Link competitions back to the event template that spawned them
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS series_event_template_id uuid REFERENCES series_event_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_competitions_event_template ON competitions(series_event_template_id);

-- 4. RLS — inherit group membership from the parent series

ALTER TABLE series_event_templates ENABLE ROW LEVEL SECURITY;

-- Members of the group (or public groups) can read
DROP POLICY IF EXISTS "set_select" ON series_event_templates;
CREATE POLICY "set_select" ON series_event_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM competition_series cs
      JOIN major_group_memberships mgm ON mgm.group_id = cs.group_id
      WHERE cs.id = series_event_templates.series_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM competition_series cs
      JOIN major_groups mg ON mg.id = cs.group_id
      WHERE cs.id = series_event_templates.series_id
        AND mg.privacy = 'public'
    )
  );

-- Only owner/admin can create
DROP POLICY IF EXISTS "set_insert" ON series_event_templates;
CREATE POLICY "set_insert" ON series_event_templates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM competition_series cs
      JOIN major_group_memberships mgm ON mgm.group_id = cs.group_id
      WHERE cs.id = series_event_templates.series_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

-- Only owner/admin can update
DROP POLICY IF EXISTS "set_update" ON series_event_templates;
CREATE POLICY "set_update" ON series_event_templates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM competition_series cs
      JOIN major_group_memberships mgm ON mgm.group_id = cs.group_id
      WHERE cs.id = series_event_templates.series_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

-- Only owner/admin can delete
DROP POLICY IF EXISTS "set_delete" ON series_event_templates;
CREATE POLICY "set_delete" ON series_event_templates FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM competition_series cs
      JOIN major_group_memberships mgm ON mgm.group_id = cs.group_id
      WHERE cs.id = series_event_templates.series_id
        AND mgm.profile_id = auth.uid()
        AND mgm.status = 'active'
        AND mgm.role IN ('owner', 'admin')
    )
  );

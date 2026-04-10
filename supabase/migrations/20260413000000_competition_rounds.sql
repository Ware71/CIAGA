-- ============================================================
-- Majors: competition_rounds — explicit per-competition round structure
-- Defines named rounds within a multi-round competition so that
-- round submissions can be keyed to a specific competition round
-- rather than just to a played round (hrr row).
-- ============================================================

-- ── competition_rounds table ──────────────────────────────────
CREATE TABLE public.competition_rounds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_number   integer NOT NULL,
  name           text NOT NULL DEFAULT '',
  scheduled_date date,
  course_id      uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(competition_id, round_number)
);

CREATE INDEX idx_competition_rounds_competition ON public.competition_rounds(competition_id);

ALTER TABLE public.competition_rounds ENABLE ROW LEVEL SECURITY;

-- Readable by authenticated users (round schedule is not secret)
CREATE POLICY "competition_rounds_select"
  ON public.competition_rounds FOR SELECT TO authenticated
  USING (true);

-- Writes go through service role (API routes)
GRANT SELECT ON public.competition_rounds TO authenticated;
GRANT ALL ON public.competition_rounds TO service_role;

-- ── Backfill: generate competition_rounds for multi-round competitions ──
-- Creates placeholder rounds for existing competitions with num_rounds > 1.
DO $$
DECLARE
  r RECORD;
  i integer;
BEGIN
  FOR r IN
    SELECT id, num_rounds
    FROM public.competitions
    WHERE num_rounds > 1
  LOOP
    FOR i IN 1..r.num_rounds LOOP
      INSERT INTO public.competition_rounds (competition_id, round_number, name)
      VALUES (r.id, i, 'Round ' || i)
      ON CONFLICT (competition_id, round_number) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- ── Extend competition_round_submissions with optional round FK ──
-- nullable so existing rows are not invalidated
ALTER TABLE public.competition_round_submissions
  ADD COLUMN IF NOT EXISTS competition_round_id  uuid REFERENCES public.competition_rounds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_status      text NOT NULL DEFAULT 'accepted'
    CHECK (submission_status IN ('pending', 'accepted', 'rejected', 'superseded', 'withdrawn', 'dq')),
  ADD COLUMN IF NOT EXISTS gross_score            integer,
  ADD COLUMN IF NOT EXISTS net_score_snapshot     integer,
  ADD COLUMN IF NOT EXISTS format_points          numeric,
  ADD COLUMN IF NOT EXISTS course_handicap_used   numeric,
  ADD COLUMN IF NOT EXISTS decided_at             timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_reason        text;

CREATE INDEX IF NOT EXISTS idx_crs_comp_round ON public.competition_round_submissions(competition_round_id);

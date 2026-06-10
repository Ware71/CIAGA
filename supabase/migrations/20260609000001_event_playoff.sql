-- Tie-break resolution for competition events.
--
-- Three new tables:
--   event_playoffs        – one session per event, tracks status and winner
--   event_playoff_holes   – each hole played in a sudden-death sequence
--   event_playoff_scores  – scores per player per playoff hole
--
-- Two new columns on event_leaderboard_entries for post-resolution display.

-- ─── event_playoffs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_playoffs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','active','completed')),
  resolution_type    text        CHECK (resolution_type IN ('playoff','countback')),
  tied_profile_ids   uuid[]      NOT NULL,
  winner_profile_id  uuid        REFERENCES public.profiles(id),
  -- elimination order: [ [round1_losers], [round2_losers], ... ] — append-only
  elimination_log    jsonb       NOT NULL DEFAULT '[]',
  created_by         uuid        REFERENCES public.profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

ALTER TABLE public.event_playoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read event_playoffs"
  ON public.event_playoffs FOR SELECT USING (auth.role() = 'authenticated');

-- ─── event_playoff_holes ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_playoff_holes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  playoff_id            uuid        NOT NULL REFERENCES public.event_playoffs(id) ON DELETE CASCADE,
  sequence              integer     NOT NULL,
  course_id             uuid        NOT NULL REFERENCES public.courses(id),
  tee_box_id            uuid        NOT NULL REFERENCES public.course_tee_boxes(id),
  hole_number           integer     NOT NULL,
  par                   integer     NOT NULL,
  stroke_index          integer     NOT NULL,
  remaining_profile_ids uuid[]      NOT NULL,  -- who is still playing this hole
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playoff_id, sequence)
);

ALTER TABLE public.event_playoff_holes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read event_playoff_holes"
  ON public.event_playoff_holes FOR SELECT USING (auth.role() = 'authenticated');

-- ─── event_playoff_scores ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_playoff_scores (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  playoff_hole_id uuid        NOT NULL REFERENCES public.event_playoff_holes(id) ON DELETE CASCADE,
  profile_id      uuid        NOT NULL REFERENCES public.profiles(id),
  gross_strokes   integer,
  net_strokes     integer,      -- gross minus strokes_received on this hole
  eliminated      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playoff_hole_id, profile_id)
);

ALTER TABLE public.event_playoff_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read event_playoff_scores"
  ON public.event_playoff_scores FOR SELECT USING (auth.role() = 'authenticated');

-- Enable Supabase Realtime on playoff scores so clients get live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_playoff_scores;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_playoffs;

-- ─── extend event_leaderboard_entries ───────────────────────────────────────

ALTER TABLE public.event_leaderboard_entries
  ADD COLUMN IF NOT EXISTS playoff_result        text
    CHECK (playoff_result IN ('won_playoff','lost_playoff','won_countback','lost_countback')),
  ADD COLUMN IF NOT EXISTS playoff_final_position integer;

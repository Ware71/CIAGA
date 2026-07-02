-- CIAGA Calendar & Scheduling
-- Adds personal availability/unavailability events (with optional iCal RRULE
-- recurrence) and personal, owner-curated "circles" of players used to layer
-- calendars for scheduling. Scheduled rounds are NOT duplicated here — they
-- already live in rounds.scheduled_at and are surfaced via get_calendar_rounds.

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
CREATE TYPE public.calendar_event_kind AS ENUM ('available', 'unavailable');

CREATE TABLE public.calendar_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind          public.calendar_event_kind NOT NULL,
  title         text,                    -- nullable: may be left blank
  all_day       boolean NOT NULL DEFAULT false,
  start_at      timestamptz NOT NULL,    -- for all_day, day boundaries in the user's tz
  end_at        timestamptz NOT NULL,
  rrule         text,                    -- iCal RRULE string; NULL = one-off (standalone)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_calendar_events_profile ON public.calendar_events(profile_id);
CREATE INDEX idx_calendar_events_start ON public.calendar_events(start_at);

-- Calendars are viewable by any authenticated user (you can view each other's
-- calendars). Writes go through service-role API routes.
CREATE POLICY "calendar_events: read all authenticated"
  ON public.calendar_events
  FOR SELECT TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- calendar_circles (personal, owner-curated — distinct from major_groups)
-- ---------------------------------------------------------------------------
CREATE TABLE public.calendar_circles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_circles ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_calendar_circles_owner ON public.calendar_circles(owner_profile_id);

CREATE TABLE public.calendar_circle_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id  uuid NOT NULL REFERENCES public.calendar_circles(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(circle_id, profile_id)
);

ALTER TABLE public.calendar_circle_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ccm_circle ON public.calendar_circle_members(circle_id);
CREATE INDEX idx_ccm_profile ON public.calendar_circle_members(profile_id);

-- RLS: circles are private to their creator.
CREATE POLICY "calendar_circles: read own"
  ON public.calendar_circles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = calendar_circles.owner_profile_id
        AND p.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "calendar_circle_members: read own circle"
  ON public.calendar_circle_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.calendar_circles c
      JOIN public.profiles p ON p.id = c.owner_profile_id
      WHERE c.id = calendar_circle_members.circle_id
        AND p.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (writes go through service role in API routes)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.calendar_events TO authenticated;
GRANT SELECT ON public.calendar_circles TO authenticated;
GRANT SELECT ON public.calendar_circle_members TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;
GRANT ALL ON public.calendar_circles TO service_role;
GRANT ALL ON public.calendar_circle_members TO service_role;

-- ---------------------------------------------------------------------------
-- get_calendar_rounds: scheduled/live rounds for a set of profiles in a range.
-- SECURITY DEFINER so a viewer can see busy markers for others' calendars
-- without needing per-row RLS on rounds/round_participants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_calendar_rounds(
  _profile_ids uuid[],
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  round_id     uuid,
  profile_id   uuid,
  name         text,
  course_name  text,
  scheduled_at timestamptz,
  status       public.round_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id            AS round_id,
    rp.profile_id   AS profile_id,
    r.name          AS name,
    c.name          AS course_name,
    r.scheduled_at  AS scheduled_at,
    r.status        AS status
  FROM round_participants rp
  JOIN rounds r ON r.id = rp.round_id
  LEFT JOIN courses c ON c.id = r.course_id
  WHERE rp.profile_id = ANY(_profile_ids)
    AND r.scheduled_at IS NOT NULL
    AND r.scheduled_at >= _from
    AND r.scheduled_at < _to
    AND r.status IN ('scheduled', 'starting', 'live');
$$;

GRANT EXECUTE ON FUNCTION public.get_calendar_rounds(uuid[], timestamptz, timestamptz) TO authenticated;

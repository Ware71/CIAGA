-- Security hardening (2026-07 audit).
-- 1) Drop stale anon read policies on round data. Anon table GRANTs were
--    already revoked in 20260121072925, so these policies are inert today —
--    removing them stops a future re-grant from silently reopening anon reads.
--    Course catalogue tables (courses / course_tee_boxes / course_tee_holes)
--    stay anon-readable: reference data, no user content.
-- 2) Calendar RPCs are SECURITY DEFINER and callable straight from the
--    browser, so they must do their own authorization. Round detail (scores,
--    handicaps, participants) is now limited to viewers with a connection to
--    the round: a participant, a follower of a participant, someone sharing
--    an active Majors group with a participant, or someone who added a
--    participant to one of their calendar circles. Busy markers on the
--    calendar are unaffected for connected players; unconnected private
--    rounds simply drop out of the result.

-- ---------------------------------------------------------------------------
-- 1. Stale anon policies
-- ---------------------------------------------------------------------------
drop policy if exists "rounds: read" on public.rounds;
drop policy if exists "round_participants: read" on public.round_participants;
drop policy if exists "round_score_events: read" on public.round_score_events;
drop policy if exists "round_course_snapshots: read" on public.round_course_snapshots;
drop policy if exists "round_tee_snapshots: read" on public.round_tee_snapshots;
drop policy if exists "round_hole_snapshots: read" on public.round_hole_snapshots;
-- (each table keeps its "read" policy: FOR SELECT TO authenticated USING (true),
--  created in 20260121072925)

-- ---------------------------------------------------------------------------
-- 2. can_view_calendar_round — connection check for calendar round detail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_calendar_round(_round_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    -- public / link rounds: any signed-in user
    EXISTS (
      SELECT 1 FROM rounds r
      WHERE r.id = _round_id
        AND r.visibility IN ('public', 'link')
        AND auth.uid() IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
      FROM round_participants rp
      WHERE rp.round_id = _round_id
        AND (
          -- viewer is a participant
          rp.profile_id IN (
            SELECT p.id FROM profiles p WHERE p.owner_user_id = auth.uid()
          )
          -- viewer follows a participant
          OR EXISTS (
            SELECT 1
            FROM follows f
            JOIN profiles vp ON vp.id = f.follower_id
            WHERE f.following_id = rp.profile_id
              AND vp.owner_user_id = auth.uid()
          )
          -- viewer shares an active Majors group with a participant
          OR EXISTS (
            SELECT 1
            FROM major_group_memberships m_p
            JOIN major_group_memberships m_v ON m_v.group_id = m_p.group_id
            JOIN profiles vp ON vp.id = m_v.profile_id
            WHERE m_p.profile_id = rp.profile_id
              AND m_p.status = 'active'
              AND m_v.status = 'active'
              AND vp.owner_user_id = auth.uid()
          )
          -- viewer added a participant to one of their calendar circles
          OR EXISTS (
            SELECT 1
            FROM calendar_circle_members ccm
            JOIN calendar_circles cc ON cc.id = ccm.circle_id
            JOIN profiles vp ON vp.id = cc.owner_profile_id
            WHERE ccm.profile_id = rp.profile_id
              AND vp.owner_user_id = auth.uid()
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_calendar_round(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_calendar_round(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_calendar_rounds — same shape as 20260704, plus the connection filter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_calendar_rounds(
  _profile_ids uuid[],
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  round_id           uuid,
  profile_id         uuid,
  participant_id     uuid,
  name               text,
  course_name        text,
  scheduled_at       timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  status             public.round_status,
  format_type        public.round_format_type,
  gross              integer,
  course_handicap    integer,
  score_differential numeric,
  player_names       text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id            AS round_id,
    rp.profile_id   AS profile_id,
    rp.id           AS participant_id,
    r.name          AS name,
    c.name          AS course_name,
    r.scheduled_at  AS scheduled_at,
    r.started_at    AS started_at,
    r.finished_at   AS finished_at,
    r.status        AS status,
    r.format_type   AS format_type,
    COALESCE(hrr.adjusted_gross_score, rct.total_strokes) AS gross,
    hrr.course_handicap_used AS course_handicap,
    hrr.score_differential   AS score_differential,
    (
      SELECT array_agg(p2.name ORDER BY p2.name)
      FROM round_participants rp2
      JOIN profiles p2 ON p2.id = rp2.profile_id
      WHERE rp2.round_id = r.id
    ) AS player_names
  FROM round_participants rp
  JOIN rounds r ON r.id = rp.round_id
  LEFT JOIN courses c ON c.id = r.course_id
  LEFT JOIN handicap_round_results hrr
    ON hrr.participant_id = rp.id AND hrr.round_id = r.id
  LEFT JOIN round_current_totals rct ON rct.participant_id = rp.id
  WHERE rp.profile_id = ANY(_profile_ids)
    AND (
      (r.status IN ('scheduled', 'starting', 'live')
        AND r.scheduled_at IS NOT NULL
        AND r.scheduled_at >= _from AND r.scheduled_at < _to)
      OR
      (r.status = 'finished'
        AND r.finished_at IS NOT NULL
        AND r.finished_at >= _from AND r.finished_at < _to)
    )
    AND public.can_view_calendar_round(r.id);
$$;

REVOKE ALL ON FUNCTION public.get_calendar_rounds(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_rounds(uuid[], timestamptz, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_calendar_round_info — gate the detail popup on the same check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_calendar_round_info(_round_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'round_id', r.id,
    'name', r.name,
    'course_name', c.name,
    'status', r.status,
    'format_type', r.format_type,
    'scheduled_at', r.scheduled_at,
    'started_at', r.started_at,
    'finished_at', r.finished_at,
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profile_id', rp.profile_id,
        'name', p.name,
        'raw_strokes', tot.raw_strokes,
        'par_played', tot.par_played,
        'ags', hrr.adjusted_gross_score,
        'course_handicap', hrr.course_handicap_used,
        'score_differential', hrr.score_differential
      ) ORDER BY p.name)
      FROM round_participants rp
      JOIN profiles p ON p.id = rp.profile_id
      LEFT JOIN handicap_round_results hrr
        ON hrr.participant_id = rp.id AND hrr.round_id = r.id
      LEFT JOIN LATERAL (
        SELECT SUM(rcs.strokes)::int AS raw_strokes,
               SUM(rhs.par)::int     AS par_played
        FROM round_current_scores rcs
        JOIN round_hole_snapshots rhs
          ON rhs.round_tee_snapshot_id = rp.tee_snapshot_id
         AND rhs.hole_number = rcs.hole_number
        WHERE rcs.participant_id = rp.id AND rcs.round_id = r.id
      ) tot ON true
      WHERE rp.round_id = r.id
    ), '[]'::jsonb)
  )
  FROM rounds r
  LEFT JOIN courses c ON c.id = r.course_id
  WHERE r.id = _round_id
    AND public.can_view_calendar_round(_round_id);
$$;

REVOKE ALL ON FUNCTION public.get_calendar_round_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_round_info(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_calendar_group_events — only for a profile the caller owns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_calendar_group_events(
  _profile_id uuid,
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  event_id    uuid,
  name        text,
  group_name  text,
  event_date  date,
  tee_time    timestamptz,
  status      text,
  event_type  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    e.id           AS event_id,
    e.name         AS name,
    g.name         AS group_name,
    e.event_date   AS event_date,
    (
      SELECT ett.tee_time
      FROM event_tee_times ett
      JOIN round_participants rp ON rp.round_id = ett.round_id
      WHERE ett.event_id = e.id
        AND rp.profile_id = _profile_id
        AND ett.tee_time IS NOT NULL
      ORDER BY ett.tee_time
      LIMIT 1
    ) AS tee_time,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM event_entries ee
        WHERE ee.event_id = e.id AND ee.profile_id = _profile_id
      ) THEN 'confirmed'
      ELSE 'draft'
    END AS status,
    e.event_type::text AS event_type
  FROM events e
  JOIN major_groups g ON g.id = e.group_id
  WHERE EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = _profile_id AND p.owner_user_id = auth.uid()
    )
    AND e.group_id IN (
      SELECT m.group_id
      FROM major_group_memberships m
      WHERE m.profile_id = _profile_id AND m.status = 'active'
    )
    AND e.majors_status IN ('upcoming', 'live')
    AND e.event_date IS NOT NULL
    AND e.event_date >= (_from AT TIME ZONE 'UTC')::date
    AND e.event_date < (_to AT TIME ZONE 'UTC')::date;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_group_events(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_group_events(uuid, timestamptz, timestamptz) TO authenticated;

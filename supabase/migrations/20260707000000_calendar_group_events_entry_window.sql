-- CIAGA Calendar v8: expose each Majors event's entry window on the calendar so
-- the event tag can read "Entered / Enter now / Entry soon" (see EntryState in
-- lib/calendar/types.ts). Extends get_calendar_group_events with
-- entry_window_start / entry_window_end (already on the events table). Adding
-- output columns changes the return type, so the function must be dropped first.

DROP FUNCTION IF EXISTS public.get_calendar_group_events(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.get_calendar_group_events(
  _profile_id uuid,
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE (
  event_id            uuid,
  name                text,
  group_name          text,
  event_date          date,
  tee_time            timestamptz,
  status              text,
  event_type          text,
  entry_window_start  timestamptz,
  entry_window_end    timestamptz
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
    e.event_type::text   AS event_type,
    e.entry_window_start AS entry_window_start,
    e.entry_window_end   AS entry_window_end
  FROM events e
  JOIN major_groups g ON g.id = e.group_id
  WHERE e.group_id IN (
      SELECT m.group_id
      FROM major_group_memberships m
      WHERE m.profile_id = _profile_id AND m.status = 'active'
    )
    AND e.majors_status IN ('upcoming', 'live')
    AND e.event_date IS NOT NULL
    AND e.event_date >= (_from AT TIME ZONE 'UTC')::date
    AND e.event_date < (_to AT TIME ZONE 'UTC')::date;
$$;

GRANT EXECUTE ON FUNCTION public.get_calendar_group_events(uuid, timestamptz, timestamptz) TO authenticated;

DROP FUNCTION IF EXISTS public.get_group_event_participants(uuid);

CREATE FUNCTION public.get_group_event_participants(p_group_id uuid)
RETURNS TABLE(profile_id uuid, first_participated_at date)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT rp.profile_id, MIN(e.event_date) AS first_participated_at
  FROM round_participants rp
  JOIN rounds r ON r.id = rp.round_id
  JOIN event_tee_times ett ON ett.id = r.event_tee_time_id
  JOIN events e ON e.id = ett.event_id
  WHERE e.group_id = p_group_id
    AND rp.profile_id IS NOT NULL
  GROUP BY rp.profile_id;
$$;

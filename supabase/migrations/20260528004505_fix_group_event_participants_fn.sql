CREATE OR REPLACE FUNCTION public.get_group_event_participants(p_group_id uuid)
RETURNS TABLE(profile_id uuid)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT rp.profile_id
  FROM round_participants rp
  JOIN rounds r ON r.id = rp.round_id
  JOIN event_tee_times ett ON ett.id = r.event_tee_time_id
  JOIN events e ON e.id = ett.event_id
  WHERE e.group_id = p_group_id
    AND rp.profile_id IS NOT NULL;
$$;

-- Update get_round_setup_participants RPC to include assigned_handicap_index

DROP FUNCTION IF EXISTS public.get_round_setup_participants(uuid);

CREATE FUNCTION public.get_round_setup_participants(_round_id uuid)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  is_guest boolean,
  display_name text,
  role text,
  profile_name text,
  profile_email text,
  profile_avatar_url text,
  handicap_index numeric,
  assigned_playing_handicap integer,
  assigned_handicap_index numeric,
  playing_handicap_used integer,
  course_handicap_used integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rp.id,
    rp.profile_id,
    rp.is_guest,
    rp.display_name,
    rp.role::text,
    p.name as profile_name,
    p.email as profile_email,
    p.avatar_url as profile_avatar_url,
    rp.handicap_index,
    rp.assigned_playing_handicap,
    rp.assigned_handicap_index,
    rp.playing_handicap_used,
    rp.course_handicap_used
  FROM public.round_participants rp
  LEFT JOIN public.profiles p ON p.id = rp.profile_id
  WHERE rp.round_id = _round_id
  ORDER BY rp.created_at;
END;
$$;

COMMENT ON FUNCTION public.get_round_setup_participants IS
  'Returns all participants for a round setup page, including handicap fields and assigned HI override.';

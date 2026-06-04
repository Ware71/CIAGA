-- Add admin-settable tournament handicap override per group membership
ALTER TABLE public.major_group_memberships
  ADD COLUMN IF NOT EXISTS tournament_index numeric(4,1);

-- Expose handicap_index on the public_profiles view
CREATE OR REPLACE VIEW public.public_profiles AS
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    p.created_at,
    ch.handicap_index
  FROM public.profiles p
  LEFT JOIN public.current_handicaps ch ON ch.profile_id = p.id;

-- CIAGA Majors: Groups and Memberships
-- Creates major_groups and major_group_memberships tables

-- Enums
CREATE TYPE public.major_group_type AS ENUM
  ('league', 'tour', 'season', 'oneoff', 'matchplay_series', 'custom');

CREATE TYPE public.major_group_privacy AS ENUM
  ('public', 'request', 'invite_only');

CREATE TYPE public.major_group_join_method AS ENUM
  ('open', 'request', 'invite_only', 'code');

CREATE TYPE public.major_group_ciaga_tag AS ENUM
  ('affiliated', 'invitational', 'official', 'none');

CREATE TYPE public.major_membership_role AS ENUM
  ('owner', 'admin', 'member');

CREATE TYPE public.major_membership_status AS ENUM
  ('active', 'pending', 'invited');

-- Groups table
CREATE TABLE public.major_groups (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  description           text,
  type                  public.major_group_type NOT NULL DEFAULT 'league',
  privacy               public.major_group_privacy NOT NULL DEFAULT 'public',
  join_method           public.major_group_join_method NOT NULL DEFAULT 'open',
  image_url             text,
  owner_profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  max_members           integer,
  season_start          date,
  season_end            date,
  default_scoring_prefs jsonb NOT NULL DEFAULT '{}',
  ciaga_tag             public.major_group_ciaga_tag NOT NULL DEFAULT 'none',
  join_code             text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.major_groups ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_major_groups_owner ON public.major_groups(owner_profile_id);
CREATE INDEX idx_major_groups_privacy ON public.major_groups(privacy);
CREATE INDEX idx_major_groups_ciaga_tag ON public.major_groups(ciaga_tag);

-- Group memberships table
CREATE TABLE public.major_group_memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       public.major_membership_role NOT NULL DEFAULT 'member',
  status     public.major_membership_status NOT NULL DEFAULT 'active',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, profile_id)
);

ALTER TABLE public.major_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_mgm_group ON public.major_group_memberships(group_id);
CREATE INDEX idx_mgm_profile ON public.major_group_memberships(profile_id);
CREATE INDEX idx_mgm_status ON public.major_group_memberships(group_id, status);

-- RLS: public groups visible to all authenticated users
CREATE POLICY "major_groups: read public"
  ON public.major_groups
  FOR SELECT TO authenticated
  USING (privacy = 'public');

-- RLS: private/request groups visible to active members
CREATE POLICY "major_groups: read as member"
  ON public.major_groups
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships m
      JOIN public.profiles p ON p.id = m.profile_id
      WHERE m.group_id = major_groups.id
        AND p.owner_user_id = auth.uid()
        AND m.status = 'active'
    )
  );

-- RLS: memberships readable if you are an active member of the group
CREATE POLICY "major_group_memberships: read own group"
  ON public.major_group_memberships
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.major_group_memberships self
      JOIN public.profiles p ON p.id = self.profile_id
      WHERE self.group_id = major_group_memberships.group_id
        AND p.owner_user_id = auth.uid()
        AND self.status = 'active'
    )
  );

-- Grants for authenticated (writes go through service role in API routes)
GRANT SELECT ON public.major_groups TO authenticated;
GRANT SELECT ON public.major_group_memberships TO authenticated;
GRANT ALL ON public.major_groups TO service_role;
GRANT ALL ON public.major_group_memberships TO service_role;

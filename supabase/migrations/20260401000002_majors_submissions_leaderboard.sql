-- CIAGA Majors: Round submissions, leaderboard, and group standings tables

-- Round submissions: links a finished round to a competition entry
CREATE TABLE public.competition_round_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id   uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  round_id         uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  score_used       numeric,
  accepted         boolean NOT NULL DEFAULT false,
  rejected_reason  text,
  UNIQUE(competition_id, round_id, profile_id)
);

ALTER TABLE public.competition_round_submissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_crs_competition ON public.competition_round_submissions(competition_id);
CREATE INDEX idx_crs_profile ON public.competition_round_submissions(profile_id);
CREATE INDEX idx_crs_round ON public.competition_round_submissions(round_id);
CREATE INDEX idx_crs_accepted ON public.competition_round_submissions(competition_id, accepted);

-- Leaderboard entries: pre-computed per competition, refreshed on each accepted submission
CREATE TABLE public.competition_leaderboard_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id      uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position            integer,
  gross_score         integer,
  net_score           integer,
  format_points       numeric,
  points_earned       numeric,
  rounds_submitted    integer NOT NULL DEFAULT 0,
  last_submission_at  timestamptz,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(competition_id, profile_id)
);

ALTER TABLE public.competition_leaderboard_entries ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_cle_competition_pos ON public.competition_leaderboard_entries(competition_id, position);
CREATE INDEX idx_cle_profile ON public.competition_leaderboard_entries(profile_id);

-- Group/season standings: rollup across competitions in a group
CREATE TABLE public.major_group_standings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES public.major_groups(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_points numeric NOT NULL DEFAULT 0,
  events_played integer NOT NULL DEFAULT 0,
  wins          integer NOT NULL DEFAULT 0,
  position      integer,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, profile_id)
);

ALTER TABLE public.major_group_standings ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_mgs_group_pos ON public.major_group_standings(group_id, position);
CREATE INDEX idx_mgs_profile ON public.major_group_standings(profile_id);

-- RLS policies
CREATE POLICY "competition_leaderboard_entries: read"
  ON public.competition_leaderboard_entries
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "major_group_standings: read"
  ON public.major_group_standings
  FOR SELECT TO authenticated
  USING (true);

-- Submissions readable by the submitting profile only
CREATE POLICY "competition_round_submissions: read own"
  ON public.competition_round_submissions
  FOR SELECT TO authenticated
  USING (
    profile_id = (
      SELECT p.id FROM public.profiles p
      WHERE p.owner_user_id = auth.uid()
      LIMIT 1
    )
  );

-- Grants
GRANT SELECT ON public.competition_round_submissions TO authenticated;
GRANT SELECT ON public.competition_leaderboard_entries TO authenticated;
GRANT SELECT ON public.major_group_standings TO authenticated;
GRANT ALL ON public.competition_round_submissions TO service_role;
GRANT ALL ON public.competition_leaderboard_entries TO service_role;
GRANT ALL ON public.major_group_standings TO service_role;

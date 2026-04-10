// CIAGA Majors — TypeScript types mirroring the database schema

// ─── Enums ──────────────────────────────────────────────────────────────────

export type MajorGroupType =
  | "league"
  | "tour"
  | "season"
  | "oneoff"
  | "matchplay_series"
  | "major_series"
  | "custom";

export type MajorGroupPrivacy = "public" | "request" | "invite_only";

export type MajorGroupJoinMethod = "open" | "request" | "invite_only" | "code";

export type MajorGroupCiagaTag = "affiliated" | "invitational" | "official" | "none";

export type MajorMembershipRole = "owner" | "admin" | "member";

export type MajorMembershipStatus = "active" | "pending" | "invited";

export type CompetitionTypeV2 =
  | "stroke"
  | "stableford"
  | "matchplay"
  | "skins"
  | "scramble"
  | "bestball"
  | "custom";

export type CompetitionScoringModel = "gross" | "net" | "stableford_points" | "match_result";

export type CompetitionPointsModel =
  | "none"
  | "fedex_style"
  | "custom_table"
  | "position_based";

export type CompetitionMajorsStatus = "upcoming" | "live" | "completed" | "cancelled";

export type StandingsContribution = "event_only" | "season" | "both";

export type CompetitionCategory = "round_based" | "aggregate" | "standalone";

// ─── Core entities ───────────────────────────────────────────────────────────

export type SeriesEventTemplate = {
  id: string;
  series_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  typical_month: number | null;
  /** null = inherit from parent CompetitionSeries */
  template_competition_type: CompetitionTypeV2 | null;
  template_scoring_model: CompetitionScoringModel | null;
  template_points_model: CompetitionPointsModel | null;
  template_rules_text: string | null;
  template_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CompetitionSeries = {
  id: string;
  group_id: string | null;
  name: string;
  description: string | null;
  recur_annually: boolean;
  typical_month: number | null;
  template_competition_type: CompetitionTypeV2;
  template_competition_category: CompetitionCategory;
  template_scoring_model: CompetitionScoringModel;
  template_points_model: CompetitionPointsModel;
  template_rules_text: string | null;
  template_settings: Record<string, unknown>;
  template_num_rounds: number;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CompetitionSeriesWithEvents = CompetitionSeries & {
  event_templates: SeriesEventTemplate[];
};

/** A year's-worth of competition instances within a series, with winner info */
export type SeriesYearGroup = {
  year: number;
  competitions: Array<{
    competition: CompetitionWithGroup;
    event_template: Pick<SeriesEventTemplate, "id" | "name" | "sort_order"> | null;
    winner: {
      profile_id: string;
      name: string | null;
      avatar_url: string | null;
      net_score: number | null;
    } | null;
  }>;
};

/** History for one named event (event template) across all years */
export type EventTemplateHistory = {
  event_template: SeriesEventTemplate;
  results: Array<{
    year: number;
    competition: Pick<CompetitionFull, "id" | "name" | "competition_date" | "majors_status">;
    winner: { profile_id: string; name: string | null; net_score: number | null } | null;
    /** The viewing player's own result in that year, if any */
    entry: { position: number | null; net_score: number | null; gross_score: number | null } | null;
  }>;
};

export type MajorGroup = {
  id: string;
  name: string;
  description: string | null;
  type: MajorGroupType;
  privacy: MajorGroupPrivacy;
  join_method: MajorGroupJoinMethod;
  image_url: string | null;
  owner_profile_id: string;
  max_members: number | null;
  season_start: string | null;
  season_end: string | null;
  default_scoring_prefs: Record<string, unknown>;
  ciaga_tag: MajorGroupCiagaTag;
  join_code: string | null;
  created_at: string;
  updated_at: string;
};

export type MajorGroupMembership = {
  id: string;
  group_id: string;
  profile_id: string;
  role: MajorMembershipRole;
  status: MajorMembershipStatus;
  joined_at: string;
};

export type MajorGroupMembershipWithProfile = MajorGroupMembership & {
  profile: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  };
};

export type CompetitionFull = {
  id: string;
  name: string;
  description: string | null;
  // Legacy fields from existing competitions table
  round_id: string | null;
  status: "draft" | "locked" | "finished";
  locked_at: string | null;
  calc_version: string;
  // New Majors fields
  group_id: string | null;
  competition_type: CompetitionTypeV2;
  format: string | null;
  course_id: string | null;
  competition_date: string | null;
  entry_window_start: string | null;
  entry_window_end: string | null;
  rules_text: string | null;
  scoring_model: CompetitionScoringModel;
  points_model: CompetitionPointsModel;
  points_table: Record<string, unknown>;
  eligibility_rules: Record<string, unknown>;
  handicap_rules: Record<string, unknown>;
  num_rounds: number;
  round_rules: Record<string, unknown>;
  time_rules: Record<string, unknown>;
  membership_rules: Record<string, unknown>;
  standings_contribution: StandingsContribution;
  majors_status: CompetitionMajorsStatus;
  created_by_profile_id: string | null;
  // Series & category fields
  series_id: string | null;
  series_event_template_id: string | null;
  competition_year: number | null;
  competition_category: CompetitionCategory;
  aggregate_config: Record<string, unknown>;
};

export type CompetitionWithGroup = CompetitionFull & {
  group: Pick<MajorGroup, "id" | "name" | "ciaga_tag"> | null;
  course: { id: string; name: string } | null;
};

export type CompetitionWithSeries = CompetitionWithGroup & {
  series: Pick<CompetitionSeries, "id" | "name"> | null;
};

export type CompetitionRoundSubmission = {
  id: string;
  competition_id: string;
  round_id: string;
  profile_id: string;
  submitted_at: string;
  score_used: number | null;
  accepted: boolean;
  rejected_reason: string | null;
};

export type CompetitionLeaderboardEntry = {
  id: string;
  competition_id: string;
  profile_id: string;
  position: number | null;
  gross_score: number | null;
  net_score: number | null;
  format_points: number | null;
  points_earned: number | null;
  rounds_submitted: number;
  last_submission_at: string | null;
  computed_at: string;
};

export type LeaderboardEntryWithProfile = CompetitionLeaderboardEntry & {
  profile: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  };
};

export type MajorGroupStanding = {
  id: string;
  group_id: string;
  profile_id: string;
  season_points: number;
  events_played: number;
  wins: number;
  position: number | null;
  computed_at: string;
};

export type GroupStandingWithProfile = MajorGroupStanding & {
  profile: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  };
};

// ─── Tee Times ───────────────────────────────────────────────────────────────

export type TeeTimeParticipant = {
  profile_id: string | null;
  is_guest: boolean;
  display_name: string | null;
  role: string;
  profile?: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  };
};

export type CompetitionTeeTime = {
  id: string;
  competition_id: string;
  round_id: string | null;
  tee_time: string;
  group_number: number | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  round?: {
    id: string;
    status: string;
    participants: TeeTimeParticipant[];
  };
};

// ─── API response shapes ──────────────────────────────────────────────────────

export type MajorHubSummary = {
  season_points: number;
  season_rank: number | null;
  events_entered: number;
  wins: number;
  active_competitions: CompetitionWithGroup[];
  upcoming_competitions: CompetitionWithGroup[];
  my_groups: Array<MajorGroup & { member_count: number }>;
  discover_groups: Array<MajorGroup & { member_count: number }>;
};

export type MajorScheduleItem = CompetitionWithGroup & {
  entry_status: "entered" | "open" | "closed" | "not_eligible";
};

export type MajorHistoryItem = {
  competition: CompetitionWithGroup;
  entry: {
    position: number | null;
    net_score: number | null;
    gross_score: number | null;
    points_earned: number | null;
  } | null;
};

export type MajorProfileData = {
  profile: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  };
  season_summary: {
    points: number;
    rank: number | null;
    events: number;
    wins: number;
    podiums: number;
  };
  career: {
    total_events: number;
    total_wins: number;
    total_podiums: number;
    avg_position: number | null;
    total_points: number;
  };
  recent_results: MajorHistoryItem[];
  group_memberships: Array<{
    group: Pick<MajorGroup, "id" | "name" | "type" | "ciaga_tag">;
    role: MajorMembershipRole;
    standing: { position: number | null; season_points: number } | null;
  }>;
};

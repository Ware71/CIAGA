// CIAGA Majors — TypeScript types mirroring the database schema

// ─── Spec-aligned enum types (Phase 1) ──────────────────────────────────────

export type SeriesType =
  | "tour"
  | "major_series"
  | "matchplay_league"
  | "matchplay_knockout"
  | "championship_series"
  | "season";

export type CompetitionStructure =
  | "standalone"
  | "multi_round"
  | "season_event"
  | "league_fixture"
  | "knockout_match";

export type ScoringBasis =
  | "gross"
  | "net"
  | "stableford_points"
  | "match_result";

export type StandingsModel =
  | "none"
  | "season_points"
  | "league_table"
  | "knockout_progression";

// ─── Enums ──────────────────────────────────────────────────────────────────

export type MajorGroupType =
  | "league"
  | "tour"
  | "season"
  | "oneoff"
  | "matchplay_series"
  | "major_series"
  | "custom"
  // Spec-aligned additions
  | "society"
  | "friend_group"
  | "major_series_host"
  | "public_organizer";

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
  | "custom"
  // Spec-aligned additions
  | "stroke_play"
  | "matchplay_fixture"
  | "matchplay_knockout_match"
  | "aggregate_stroke_play"
  | "team_best_ball"
  | "team_scramble";

export type CompetitionScoringModel = "gross" | "net" | "stableford_points" | "match_result";

export type CompetitionPointsModel =
  | "none"
  | "fedex_style"
  | "custom_table"
  | "position_based";

export type CompetitionMajorsStatus =
  | "upcoming"
  | "live"
  | "completed"
  | "cancelled"
  // Spec-aligned additions
  | "draft"
  | "published"
  | "entry_open"
  | "entry_closed"
  | "unofficial"
  | "official"
  | "archived";

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
  // Spec-aligned additions
  series_type: SeriesType;
  is_active: boolean;
  default_start_month: number | null;
  default_end_month: number | null;
};

// ── SeriesSeason ─────────────────────────────────────────────
export type SeasonStatus = "draft" | "published" | "live" | "completed" | "archived";

export type SeriesSeason = {
  id: string;
  series_id: string;
  season_year: number;
  name: string;
  status: SeasonStatus;
  start_date: string | null;
  end_date: string | null;
  standings_model: StandingsModel;
  standings_rules_version_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SeriesSeasonWithSeries = SeriesSeason & {
  series: Pick<CompetitionSeries, "id" | "name" | "series_type" | "group_id">;
};

// ── CompetitionRulesVersion ───────────────────────────────────
export type CompetitionRulesVersion = {
  id: string;
  competition_id: string | null;
  source_template_id: string | null;
  rules_version: number;
  competition_format: CompetitionTypeV2;
  competition_structure: CompetitionStructure;
  scoring_basis: ScoringBasis;
  handicap_config: Record<string, unknown>;
  points_config: Record<string, unknown>;
  tie_break_config: Record<string, unknown>;
  eligibility_config: Record<string, unknown>;
  cut_config: Record<string, unknown> | null;
  matchplay_config: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  created_by_profile_id: string | null;
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
  // Upgrade additions
  allow_credit: boolean;
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

export type PrizeTableEntry = {
  position: number;
  pct: number;
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
  // Spec-aligned additions
  season_id: string | null;
  competition_structure: CompetitionStructure;
  scoring_basis: ScoringBasis | null;
  published_rules_version_id: string | null;
  // Upgrade additions
  allow_self_withdrawal: boolean;
  tee_time_mode: "admin_assigned" | "self_select";
  waitlist_enabled: boolean;
  max_entries: number | null;
  prize_table: PrizeTableEntry[] | null;
  entry_fee_amount: number | null;
  entry_fee_currency: string;
  entry_fee_notes: string | null;
};

export type CompetitionWithGroup = CompetitionFull & {
  group: Pick<MajorGroup, "id" | "name" | "type" | "ciaga_tag"> | null;
  course: { id: string; name: string } | null;
};

export type CompetitionWithSeries = CompetitionWithGroup & {
  series: Pick<CompetitionSeries, "id" | "name"> | null;
};

export type SubmissionStatus = "pending" | "accepted" | "rejected" | "superseded" | "withdrawn" | "dq";

export type CompetitionRoundSubmission = {
  id: string;
  competition_id: string;
  round_id: string;
  profile_id: string;
  submitted_at: string;
  score_used: number | null;
  accepted: boolean;
  rejected_reason: string | null;
  // Spec-aligned additions
  competition_round_id: string | null;
  submission_status: SubmissionStatus;
  gross_score: number | null;
  net_score_snapshot: number | null;
  format_points: number | null;
  course_handicap_used: number | null;
  decided_at: string | null;
  decided_by_profile_id: string | null;
  decision_reason: string | null;
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

// ─── Season standings ────────────────────────────────────────────────────────

export type SeasonStandingsEntry = {
  season_id: string;
  profile_id: string;
  position: number | null;
  season_points: number;
  events_played: number;
  wins: number;
  top_3s: number;
  best_finish: number | null;
  last_computed_at: string;
};

export type SeasonStandingsEntryWithProfile = SeasonStandingsEntry & {
  profile: { id: string; name: string | null; avatar_url: string | null };
};

// ─── Competition rounds ───────────────────────────────────────────────────────

export type CompetitionRoundStatus = "scheduled" | "live" | "completed" | "cancelled";

export type CompetitionRound = {
  id: string;
  competition_id: string;
  round_number: number;
  name: string;
  scheduled_date: string | null;
  course_id: string | null;
  status: CompetitionRoundStatus;
  created_at: string;
};

// ─── Audit log ───────────────────────────────────────────────────────────────

export type CompetitionAuditActionType =
  | "created"
  | "published"
  | "entry_opened"
  | "entry_closed"
  | "rules_changed"
  | "submission_accepted"
  | "submission_rejected"
  | "leaderboard_recomputed"
  | "status_changed"
  | "fixture_result_updated";

export type CompetitionAuditLog = {
  id: string;
  competition_id: string;
  actor_profile_id: string | null;
  action_type: CompetitionAuditActionType | string;
  payload: Record<string, unknown>;
  created_at: string;
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

// ─── Matchplay types ─────────────────────────────────────────────────────────

export type MatchplayStageType =
  | "league_phase" | "group_phase"
  | "round_of_16" | "quarter_final" | "semi_final" | "final"
  | "placement" | "custom";

export type MatchplayStage = {
  id: string;
  competition_id: string;
  stage_type: MatchplayStageType;
  name: string;
  sort_order: number;
  group_label: string | null;
  created_at: string;
};

export type MatchplayFixtureStatus = "scheduled" | "live" | "completed" | "walkover" | "cancelled";

export type MatchplayResultType =
  | "home_win" | "away_win" | "halved"
  | "walkover_home" | "walkover_away" | "double_withdrawal";

export type MatchplayFixture = {
  id: string;
  competition_id: string;
  stage_id: string | null;
  round_number: number | null;
  home_entry_id: string | null;
  away_entry_id: string | null;
  scheduled_at: string | null;
  status: MatchplayFixtureStatus;
  result_type: MatchplayResultType | null;
  winning_entry_id: string | null;
  margin_holes: number | null;
  holes_remaining: number | null;
  extra_holes_played: number | null;
  approved_at: string | null;
  approved_by_profile_id: string | null;
  notes: string | null;
};

export type MatchplayBracketSlotSourceType = "entry" | "winner_of_fixture" | "loser_of_fixture" | "bye";

export type MatchplayBracketSlot = {
  id: string;
  competition_id: string;
  stage_id: string;
  fixture_id: string;
  slot_number: 1 | 2;
  source_type: MatchplayBracketSlotSourceType;
  source_entry_id: string | null;
  source_fixture_id: string | null;
};

export type MatchplayLeagueTableEntry = {
  id: string;
  competition_id: string;
  stage_id: string | null;
  profile_id: string;
  played: number;
  won: number;
  halved: number;
  lost: number;
  league_points: number;
  matches_for: number | null;
  matches_against: number | null;
  position: number | null;
  last_computed_at: string;
};

export type MatchplayLeagueTableEntryWithProfile = MatchplayLeagueTableEntry & {
  profile: { id: string; name: string | null; avatar_url: string | null };
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

// ─── Financial types ──────────────────────────────────────────────────────────

// PrizeTableEntry defined above (before CompetitionFull) to avoid forward reference

export type BalanceTransactionType =
  | "entry_fee"
  | "extra_charge"
  | "payment"
  | "winnings"
  | "adjustment";

export type CompetitionExtra = {
  id: string;
  competition_id: string;
  name: string;
  amount: number;
  description: string | null;
  created_by: string;
  created_at: string;
};

export type GroupBalanceTransaction = {
  id: string;
  group_id: string;
  profile_id: string;
  competition_id: string | null;
  competition_extra_id: string | null;
  type: BalanceTransactionType;
  /** Positive = charged to player, negative = credit to player */
  amount: number;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type GroupBalanceTransactionWithDetails = GroupBalanceTransaction & {
  competition?: Pick<CompetitionFull, "id" | "name"> | null;
  extra?: Pick<CompetitionExtra, "id" | "name"> | null;
  recorded_by_profile?: { id: string; name: string | null } | null;
};

export type CompetitionWinning = {
  id: string;
  competition_id: string;
  profile_id: string;
  position: number | null;
  amount: number;
  note: string | null;
  recorded_by: string;
  created_at: string;
};

export type CompetitionWinningWithProfile = CompetitionWinning & {
  profile: { id: string; name: string | null; avatar_url: string | null };
};

/** Per-member balance summary returned by GET /api/majors/groups/[id]/balances */
export type MemberBalanceSummary = {
  profile_id: string;
  profile: { id: string; name: string | null; avatar_url: string | null };
  total_charged: number;
  total_paid: number;
  /** Positive = owes money, negative = in credit */
  balance: number;
  transactions: GroupBalanceTransactionWithDetails[];
};

/** Proposed winnings from prize table auto-compute */
export type ProposedWinning = {
  profile_id: string;
  profile: { id: string; name: string | null; avatar_url: string | null };
  position: number;
  amount: number;
};

// ─── Waitlist ─────────────────────────────────────────────────────────────────

export type WaitlistStatus = "waiting" | "offered" | "expired" | "joined";

export type CompetitionWaitlistEntry = {
  id: string;
  competition_id: string;
  profile_id: string;
  status: WaitlistStatus;
  offered_at: string | null;
  joined_at: string | null;
  created_at: string;
};

export type CompetitionWaitlistEntryWithProfile = CompetitionWaitlistEntry & {
  profile: { id: string; name: string | null; avatar_url: string | null };
};

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationType =
  | "tee_time_assigned"
  | "tee_time_reminder"
  | "waitlist_offered";

export type UserNotification = {
  id: string;
  profile_id: string;
  type: NotificationType | string;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
};

// ─── Season financials ────────────────────────────────────────────────────────

export type SeasonFinancialSummary = {
  season_id: string;
  total_entry_fees: number;
  total_extras: number;
  total_winnings_paid: number;
  pot_balance: number; // total_entry_fees + total_extras - total_winnings_paid
  per_player: Array<{
    profile_id: string;
    profile: { id: string; name: string | null; avatar_url: string | null };
    charged: number;
    paid: number;
    winnings: number;
    net_balance: number;
  }>;
};

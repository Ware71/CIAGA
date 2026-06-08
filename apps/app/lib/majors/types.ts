// CIAGA Majors — TypeScript types mirroring the database schema

// ─── Spec-aligned enum types (Phase 1) ──────────────────────────────────────

export type CompetitionType =
  | "tour"
  | "major_series"
  | "matchplay_league"
  | "matchplay_knockout"
  | "championship_series"
  | "season";

export type EventStructure =
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
  | "matchplay_knockout"
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

export type EventTypeV2 =
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

export type EventScoringModel = "gross" | "net" | "stableford_points" | "match_result";

export type EventPointsModel =
  | "none"
  | "fedex_style"
  | "custom_table"
  | "position_based"
  | "ciaga_formula"
  | "custom_formula";

/** Stored in events.points_config for formula-based points models. */
export type PointsConfig = {
  /** Optional field size override (F). If omitted, SQL counts actual finishers. */
  num_participants?: number;
  // custom_formula overrides — ciaga_formula uses the defaults shown below
  base?: number;              // floor points (default: 18)
  scale?: number;             // peak spread above floor (default: 32)
  compression?: number;       // position curve exponent (default: 0.7)
  field_sensitivity?: number; // field size scaling exponent (default: 0.2)
  win_bonus_scale?: number;   // win bonus coefficient (default: 5)
  round_coefficient?: number; // round multiplier step (default: 0.2)
};

export type EventStatus =
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

export type LeaderboardFreezeScope = "all" | "top_x";
export type LeaderboardFreezeState = "live" | "frozen" | "revealed";
export type LeaderboardRevealStyle = "none" | "animated" | "suspense" | "rapid" | "podium";

export type LeaderboardFreezeConfig = {
  leaderboard_freeze_last_holes: number | null;
  leaderboard_freeze_scope: LeaderboardFreezeScope;
  leaderboard_freeze_top_x: number | null;
  leaderboard_freeze_auto_reveal: boolean;
  leaderboard_freeze_state: LeaderboardFreezeState;
  leaderboard_reveal_style: LeaderboardRevealStyle;
  leaderboard_reveal_top_x: number | null;
};

export type EventCategory = "round_based" | "aggregate" | "standalone";

// ─── Core entities ───────────────────────────────────────────────────────────

export type CompetitionEventTemplate = {
  id: string;
  competition_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  typical_month: number | null;
  /** null = inherit from parent Competition */
  template_event_type: EventTypeV2 | null;
  template_scoring_model: EventScoringModel | null;
  template_points_model: EventPointsModel | null;
  template_rules_text: string | null;
  template_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Competition = {
  id: string;
  group_id: string | null;
  name: string;
  description: string | null;
  recur_annually: boolean;
  typical_month: number | null;
  template_event_type: EventTypeV2;
  template_event_category: EventCategory;
  template_scoring_model: EventScoringModel;
  template_points_model: EventPointsModel;
  template_rules_text: string | null;
  template_settings: Record<string, unknown>;
  template_num_rounds: number;
  default_prize_pots: Array<{
    name: string;
    distribution_type: string;
    entry_fee_amount: number | null;
    is_mandatory: boolean;
    is_monetary: boolean;
  }> | null;
  created_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
  // Spec-aligned additions
  competition_type: CompetitionType;
  is_active: boolean;
  default_start_month: number | null;
  default_end_month: number | null;
};

// ── Competition with enriched data ────────────────────────────────
export type CompetitionWithHolder = Competition & {
  event_templates: Pick<CompetitionEventTemplate, "id">[];
  current_holder: { name: string | null; avatar_url: string | null } | null;
};

// ── EventRulesVersion ───────────────────────────────────────────────
export type EventRulesVersion = {
  id: string;
  event_id: string | null;
  source_template_id: string | null;
  rules_version: number;
  event_format: EventTypeV2;
  event_structure: EventStructure;
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

export type CompetitionWithEventTemplates = Competition & {
  event_templates: CompetitionEventTemplate[];
};

/** A year's-worth of event instances within a competition, with winner info */
export type CompetitionYearGroup = {
  year: number;
  events: Array<{
    event: EventWithGroup;
    event_template: Pick<CompetitionEventTemplate, "id" | "name" | "sort_order"> | null;
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
  event_template: CompetitionEventTemplate;
  results: Array<{
    year: number;
    event: Pick<EventFull, "id" | "name" | "event_date" | "majors_status">;
    winner: { profile_id: string; name: string | null; net_score: number | null } | null;
    /** The viewing player's own result in that year, if any */
    entry: { position: number | null; net_score: number | null; gross_score: number | null } | null;
  }>;
};

/** Aggregated career stats for one player at one recurring event template */
export type EventViewerStats = {
  appearances: number;
  wins: number;
  avg_finish: number | null;
  best_finish: number | null;
  avg_net_score: number | null;
  best_net_score: number | null;
};

export type GroupHandicapRules = {
  mode: "allowance_pct" | "compare_against_lowest" | "fixed" | "none";
  allowance_pct: number | null;
  max_handicap: number | null;
};

export type GroupScoringPrefs = {
  scoring_model: EventScoringModel | null;
  competition_type: EventTypeV2 | null;
  handicap_rules: GroupHandicapRules | null;
  points_model: EventPointsModel | null;
  standings_contribution: StandingsContribution | null;
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
  default_scoring_prefs: GroupScoringPrefs;
  ciaga_tag: MajorGroupCiagaTag;
  join_code: string | null;
  created_at: string;
  updated_at: string;
  // Upgrade additions
  allow_credit: boolean;
};

export type GroupSeasonStatus = "upcoming" | "active" | "completed";

export type GroupSeason = {
  id: string;
  group_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: GroupSeasonStatus;
  season_type: "calendar_year" | "custom";
  season_year: number | null;
  season_label: string | null;
  standings_model: StandingsModel;
  config_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type GroupSeasonStandingsEntry = {
  group_season_id: string;
  profile_id: string;
  position: number | null;
  season_points: number;
  events_played: number;
  wins: number;
  top_3s: number;
  best_finish: number | null;
  last_computed_at: string;
};

export type GroupSeasonStandingsEntryWithProfile = GroupSeasonStandingsEntry & {
  profile: { id: string; name: string | null; avatar_url: string | null };
};

export type MajorGroupMembership = {
  id: string;
  group_id: string;
  profile_id: string;
  role: MajorMembershipRole;
  status: MajorMembershipStatus;
  joined_at: string;
  preferred_tee_name: string | null;
  tournament_index: number | null;
  handicap_index: number | null;
  has_participated: boolean;
};

export type MajorGroupMembershipWithProfile = MajorGroupMembership & {
  profile: {
    id: string;
    name: string | null;
    avatar_url: string | null;
    gender: string | null;
  } | null;
};

export type PrizeTableEntry = {
  position: number;
  pct: number;
};

export type EventFull = {
  id: string;
  name: string;
  description: string | null;
  // Legacy fields from existing events table
  round_id: string | null;
  status: "draft" | "locked" | "finished";
  locked_at: string | null;
  calc_version: string;
  // New Majors fields
  group_id: string | null;
  event_type: EventTypeV2;
  format: string | null;
  course_id: string | null;
  event_date: string | null;
  entry_window_start: string | null;
  entry_window_end: string | null;
  rules_text: string | null;
  scoring_model: EventScoringModel;
  points_model: EventPointsModel;
  points_table: Record<string, unknown>;
  points_config: PointsConfig | null;
  eligibility_rules: Record<string, unknown>;
  handicap_rules: Record<string, unknown>;
  num_rounds: number;
  round_rules: Record<string, unknown>;
  time_rules: Record<string, unknown>;
  membership_rules: Record<string, unknown>;
  standings_contribution: StandingsContribution;
  majors_status: EventStatus;
  created_by_profile_id: string | null;
  // Competition & category fields
  competition_id: string | null;
  competition_event_template_id: string | null;
  event_year: number | null;
  event_category: EventCategory;
  aggregate_config: Record<string, unknown>;
  // Spec-aligned additions
  group_season_id: string | null;
  event_structure: EventStructure;
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
  // Leaderboard freeze / ceremony reveal
  leaderboard_freeze_last_holes: number | null;
  leaderboard_freeze_scope: LeaderboardFreezeScope;
  leaderboard_freeze_top_x: number | null;
  leaderboard_freeze_auto_reveal: boolean;
  leaderboard_freeze_state: LeaderboardFreezeState;
  leaderboard_reveal_style: LeaderboardRevealStyle;
  leaderboard_reveal_top_x: number | null;
};

export type EventWithGroup = EventFull & {
  group: Pick<MajorGroup, "id" | "name" | "type" | "ciaga_tag"> | null;
  course: { id: string; name: string; city: string | null; country: string | null } | null;
  rounds?: { course_id: string | null; course: { city: string | null; country: string | null } | null }[] | null;
};

export type EventWithCompetition = EventWithGroup & {
  competition: Pick<Competition, "id" | "name"> | null;
};

export type SubmissionStatus = "pending" | "accepted" | "rejected" | "superseded" | "withdrawn" | "dq";

export type EventRoundSubmission = {
  id: string;
  event_id: string;
  round_id: string;
  profile_id: string;
  submitted_at: string;
  score_used: number | null;
  accepted: boolean;
  rejected_reason: string | null;
  // Spec-aligned additions
  event_round_id: string | null;
  submission_status: SubmissionStatus;
  gross_score: number | null;
  net_score_snapshot: number | null;
  format_points: number | null;
  course_handicap_used: number | null;
  decided_at: string | null;
  decided_by_profile_id: string | null;
  decision_reason: string | null;
};

export type EventLeaderboardEntry = {
  id: string;
  event_id: string;
  profile_id: string;
  position: number | null;
  gross_score: number | null;
  net_score: number | null;
  format_points: number | null;
  points_earned: number | null;
  rounds_submitted: number;
  last_submission_at: string | null;
  computed_at: string;
  is_live: boolean;
  holes_completed: number;
  to_par: number | null;
  course_par: number | null;
  playoff_result: "won_playoff" | "lost_playoff" | "won_countback" | "lost_countback" | null;
  playoff_final_position: number | null;
};

// ─── Playoff types ────────────────────────────────────────────────────────────

export type PlayoffStatus = "pending" | "active" | "completed";
export type PlayoffResolutionType = "playoff" | "countback";
export type PlayoffResult = "won_playoff" | "lost_playoff" | "won_countback" | "lost_countback";

export type EventPlayoff = {
  id: string;
  event_id: string;
  status: PlayoffStatus;
  resolution_type: PlayoffResolutionType | null;
  tied_profile_ids: string[];
  winner_profile_id: string | null;
  elimination_log: string[][];
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};

export type EventPlayoffHole = {
  id: string;
  playoff_id: string;
  sequence: number;
  course_id: string;
  tee_box_id: string;
  hole_number: number;
  par: number;
  stroke_index: number;
  remaining_profile_ids: string[];
  created_at: string;
};

export type EventPlayoffScore = {
  id: string;
  playoff_hole_id: string;
  profile_id: string;
  gross_strokes: number | null;
  net_strokes: number | null;
  eliminated: boolean;
  created_at: string;
};

export type PlayoffHoleWithScores = EventPlayoffHole & {
  scores: EventPlayoffScore[];
};

export type CountbackBreakdown = {
  step: string;    // e.g. "Last 9", "Last 6", "Hole 18"
  holeRange: string;
  scores: Record<string, number | null>;  // profile_id → score sum
  resolvedAt: boolean;
};

export type CountbackResult = {
  winner_profile_id: string | null;
  step_resolved: string | null;
  final_positions: Array<{ profile_id: string; position: number }>;
  breakdown: CountbackBreakdown[];
};

export type LeaderboardEntryWithProfile = EventLeaderboardEntry & {
  profile: {
    id: string;
    name: string | null;
    avatar_url: string | null;
  };
  // Round ID from submission map (may be present on event-scoped leaderboard)
  round_id?: string | null;
};

export type FrozenLeaderboardEntry = {
  profile_id: string;
  gross_score: number | null;
  net_score: number | null;
  to_par?: number | null;
  format_points?: number | null;
  points_earned?: number | null;
  holes_shown: number;
  actual_holes_completed?: number;
  is_live: boolean;
  position: number | null;
  profile?: {
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


// ─── Event rounds ───────────────────────────────────────────────────────────

export type EventRoundStatus = "scheduled" | "live" | "completed" | "cancelled";

export type EventRound = {
  id: string;
  event_id: string;
  round_number: number;
  name: string;
  scheduled_date: string | null;
  course_id: string | null;
  default_tee_box_id_male: string | null;
  default_tee_box_id_female: string | null;
  status: EventRoundStatus;
  created_at: string;
  course?: { id: string; name: string } | null;
  tee_male?: { id: string; name: string } | null;
  tee_female?: { id: string; name: string } | null;
};

// ─── Audit log ───────────────────────────────────────────────────────────────

export type EventAuditActionType =
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

export type EventAuditLog = {
  id: string;
  event_id: string;
  actor_profile_id: string | null;
  action_type: EventAuditActionType | string;
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

export type EventTeeTime = {
  id: string;
  event_id: string;
  event_round_id: string | null;
  round_id: string | null;
  tee_time: string;
  group_number: number | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  event_round?: {
    id: string;
    round_number: number;
    name: string;
    scheduled_date: string | null;
  } | null;
  round?: {
    id: string;
    status: string;
    participants: TeeTimeParticipant[];
  } | null;
};

// ─── Matchplay types ─────────────────────────────────────────────────────────

export type MatchplayStageType =
  | "league_phase" | "group_phase"
  | "round_of_16" | "quarter_final" | "semi_final" | "final"
  | "placement" | "custom";

export type MatchplayStage = {
  id: string;
  event_id: string;
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
  event_id: string;
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
  event_id: string;
  stage_id: string;
  fixture_id: string;
  slot_number: 1 | 2;
  source_type: MatchplayBracketSlotSourceType;
  source_entry_id: string | null;
  source_fixture_id: string | null;
};

export type MatchplayLeagueTableEntry = {
  id: string;
  event_id: string;
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

export type MajorGroupSeasonStats = {
  group_id: string;
  group_name: string;
  group_image_url: string | null;
  events: number;
  rounds_played: number;
  wins: number;
  earnings: number;
  season_points: number;
  season_rank: number | null;
};

export type PendingInvite = {
  group_id: string;
  group: { id: string; name: string; image_url: string | null };
};

export type MajorHubSummary = {
  season_events: number;
  season_rounds_played: number;
  season_wins: number;
  season_earnings: number;
  alltime_events: number;
  alltime_rounds_played: number;
  alltime_wins: number;
  alltime_earnings: number;
  group_stats: MajorGroupSeasonStats[];
  active_events: EventWithGroup[];
  upcoming_events: EventWithGroup[];
  my_groups: Array<MajorGroup & { member_count: number }>;
  discover_groups: Array<MajorGroup & { member_count: number }>;
  pending_invites: PendingInvite[];
};

export type MajorScheduleItem = EventWithGroup & {
  entry_status: "entered" | "open" | "closed" | "not_eligible";
};

export type MajorHistoryItem = {
  event: EventWithGroup;
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

// PrizeTableEntry defined above (before EventFull) to avoid forward reference

export type BalanceTransactionType =
  | "entry_fee"
  | "green_fee"
  | "extra_charge"
  | "payment"
  | "winnings"
  | "adjustment"
  /** Admin physically hands prize money to the player. Reduces balance but excluded from winnings stats. */
  | "withdrawal";

export type EventChargeCategory = "green_fee" | "buggy" | "food" | "drink" | "other";

export type EventCharge = {
  id: string;
  event_id: string;
  /** null = whole-event charge; set = round-specific charge */
  round_id: string | null;
  name: string;
  amount: number;
  category: EventChargeCategory;
  description: string | null;
  applies_to_all_entries: boolean;
  /** If true, automatically charged to players when they join the event */
  is_mandatory: boolean;
  created_by: string;
  created_at: string;
};

export type EventPlayerCharge = {
  id: string;
  event_id: string;
  charge_id: string | null;
  profile_id: string;
  name: string;
  amount: number;
  category: EventChargeCategory;
  charge_transaction_id: string | null;
  payment_transaction_id: string | null;
  /** Derived: payment_transaction_id IS NOT NULL */
  is_paid: boolean;
  created_by: string | null;
  created_at: string;
};

export type EventPlayerChargeWithProfile = EventPlayerCharge & {
  profile: { id: string; name: string | null; avatar_url: string | null };
};

export type EventExtra = {
  id: string;
  event_id: string;
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
  event_id: string | null;
  event_extra_id: string | null;
  type: BalanceTransactionType;
  /** Positive = charged to player, negative = credit to player */
  amount: number;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type GroupBalanceTransactionWithDetails = GroupBalanceTransaction & {
  event?: Pick<EventFull, "id" | "name"> | null;
  extra?: Pick<EventExtra, "id" | "name"> | null;
  recorded_by_profile?: { id: string; name: string | null } | null;
};

export type EventWinning = {
  id: string;
  event_id: string;
  profile_id: string;
  position: number | null;
  amount: number;
  note: string | null;
  recorded_by: string;
  created_at: string;
};

export type EventWinningWithProfile = EventWinning & {
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

export type EventWaitlistEntry = {
  id: string;
  event_id: string;
  profile_id: string;
  status: WaitlistStatus;
  offered_at: string | null;
  joined_at: string | null;
  created_at: string;
};

export type EventWaitlistEntryWithProfile = EventWaitlistEntry & {
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
  group_season_id: string;
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

// ─── Prize Pots ───────────────────────────────────────────────────────────────

export type PrizePotDistributionType =
  | "position_based"           // 1st/2nd/3rd splits from prize_table
  | "metric_weighted"          // proportional to metric value (e.g. 3 twos → 3× share)
  | "metric_equal"             // equal share to each player with metric_value >= 1
  | "equal_split"              // split equally among all enrolled players
  | "non_monetary"             // no cash; prize_description only
  | "entry_only"               // entry fee charged, no distribution
  | "season_standings_winner"; // 100% to season standings leader when season completes; ties split equally

export type PrizePotMetricType =
  | "twos"          // auto-calculated from hole scores
  | "nearest_pin"   // manually recorded
  | "longest_drive" // manually recorded
  | "season_points" // from competition season standings
  | "custom";       // admin-defined, manually recorded

export type PrizePotStatus = "active" | "locked" | "distributed";

export type PrizePot = {
  id: string;
  group_id: string;
  /** Exactly one of these is set */
  event_id: string | null;
  group_season_id: string | null;
  name: string;
  description: string | null;
  entry_fee_amount: number | null;
  entry_fee_currency: string;
  entry_fee_notes: string | null;
  distribution_type: PrizePotDistributionType;
  prize_table: PrizeTableEntry[] | null;
  metric_type: PrizePotMetricType | null;
  metric_description: string | null;
  is_monetary: boolean;
  prize_description: string | null;
  /** If true, players are automatically enrolled when joining an event in this pot's scope */
  is_mandatory: boolean;
  status: PrizePotStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PrizePotEntry = {
  id: string;
  prize_pot_id: string;
  profile_id: string;
  amount_contributed: number;
  transaction_id: string | null;
  metric_value: number | null;
  metric_detail: Array<{ round_id: string; hole_number: number; score: number }> | null;
  enrolled_at: string;
};

export type PrizePotEntryWithProfile = PrizePotEntry & {
  profile: { id: string; name: string | null; avatar_url: string | null };
};

export type PrizePotPayout = {
  id: string;
  prize_pot_id: string;
  profile_id: string;
  position: number | null;
  amount: number | null;
  note: string | null;
  transaction_id: string | null;
  recorded_by: string;
  recorded_at: string;
};

export type PrizePotPayoutWithProfile = PrizePotPayout & {
  profile: { id: string; name: string | null; avatar_url: string | null };
};

export type PrizePotWithDetails = PrizePot & {
  entries: PrizePotEntryWithProfile[];
  payouts: PrizePotPayoutWithProfile[];
  /** Sum of all entry contributions */
  total_pot: number;
};

// ─── Group Charges ────────────────────────────────────────────────────────────

/** Standalone group-level charge not tied to any event or season */
export type GroupCharge = {
  id: string;
  group_id: string;
  name: string;
  amount: number;
  description: string | null;
  category: string;
  is_mandatory: boolean;
  is_active: boolean;
  created_by: string;
  created_at: string;
};

// ─── Join Preview ─────────────────────────────────────────────────────────────

/** Returned by GET /api/majors/events/[id]/join-preview */
export type EventJoinPreview = {
  mandatory_charges: EventCharge[];
  optional_charges: EventCharge[];
  mandatory_prize_pots: PrizePot[];
  optional_prize_pots: PrizePot[];
  season_mandatory_pots: PrizePot[];
  season_optional_pots: PrizePot[];
  group_mandatory_charges: GroupCharge[];
  group_optional_charges: GroupCharge[];
  entry_fee_amount: number | null;
  current_balance: number;
  projected_balance: number;
};

// ─── Winnings Summary ─────────────────────────────────────────────────────────

export type PotTransaction = {
  pot_id: string;
  pot_name: string;
  event_id: string | null;
  event_name: string | null;
  season_id: string | null;
  season_name: string | null;
  entry_fee: number;
  payout_amount: number | null;
  payout_position: number | null;
  date: string;
};

export type PlayerWinningSummary = {
  profile_id: string;
  profile: { id: string; name: string | null; avatar_url: string | null };
  all_time_spent: number;
  all_time_won: number;
  all_time_net: number;
  undrawn_winnings: number;
  by_season: Array<{
    group_season_id: string | null;
    season_name: string;
    spent: number;
    won: number;
  }>;
  pot_history: PotTransaction[];
};

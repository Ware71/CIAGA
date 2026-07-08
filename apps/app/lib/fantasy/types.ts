// Fantasy Picks — shared types.
// Keep this module free of runtime imports from lib/majors so either side can
// type-import the other without cycles.

export type FantasyMode = "fixed" | "topup";
export type FantasyBudgetScope = "season" | "event";

/** Stored in major_groups.fantasy_config (NULL = feature disabled). */
export type FantasyConfig = {
  mode: FantasyMode;
  budgetScope: FantasyBudgetScope;
  /** Whole points granted per scope (per season, or per event). */
  budgetAmount: number;
  /** Top-up mode only — whole points per top-up unit. */
  topupIncrement?: number;
  enabledAt: string;
  updatedByProfileId: string;
};

export type FantasyWalletTransactionType =
  | "budget_grant"
  | "topup"
  | "stake"
  | "payout"
  | "cashout"
  | "void_refund"
  | "adjustment";

/** Transaction types that count toward PnL (net profit). Grants/top-ups excluded. */
export const PNL_TRANSACTION_TYPES: FantasyWalletTransactionType[] = [
  "stake",
  "payout",
  "cashout",
  "void_refund",
];

export type FantasyWalletTransaction = {
  id: string;
  group_id: string;
  profile_id: string;
  group_season_id: string | null;
  event_id: string | null;
  pick_id: string | null;
  type: FantasyWalletTransactionType;
  /** Positive = credit to player, negative = debit (stakes). */
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/**
 * The ledger scope a balance is summed over, derived from the group's
 * budgetScope config:
 *   season   → rows carrying the current group_season_id
 *   event    → rows carrying a specific event_id
 *   lifetime → rows carrying neither (season-scoped groups with no seasons)
 */
export type WalletScope =
  | { kind: "season"; groupSeasonId: string }
  | { kind: "event"; eventId: string }
  | { kind: "lifetime" };

export type FantasyWalletSummary = {
  scope: WalletScope;
  balance: number;
  /** Net profit across the whole group (stake/payout/cashout/void_refund only). */
  pnl: number;
};

export type FantasyEventState = {
  event_id: string;
  group_id: string;
  version: number;
  odds_stale: boolean;
  changed_reason: string | null;
  last_refreshed_at: string | null;
  is_final: boolean;
  created_at: string;
  updated_at: string;
};

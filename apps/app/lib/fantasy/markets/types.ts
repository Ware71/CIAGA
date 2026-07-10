import type { SimulationResult } from "@/lib/fantasy/simulation/types";

export type FantasyMarketType =
  | "outright_winner"
  | "top_n"
  | "score_total"
  | "birdies"
  | "h2h"
  | "finish_position"
  | "finish_range"
  | "score_band"
  | "eagle_count"
  | "hole_score"
  | "field_special";

export type FantasyMarketStatus = "open" | "suspended" | "settled" | "void";

/** Board sections, in display order. Every market type belongs to one. */
export type MarketGroup =
  | "winner"
  | "position"
  | "match"
  | "scoring"
  | "birdies"
  | "holes"
  | "specials";

export const MARKET_GROUPS: { id: MarketGroup; label: string }[] = [
  { id: "winner", label: "Winner" },
  { id: "position", label: "Finishing Position" },
  { id: "match", label: "Match Bets" },
  { id: "scoring", label: "Player Scoring" },
  { id: "birdies", label: "Birdies & Eagles" },
  { id: "holes", label: "Hole Specials" },
  { id: "specials", label: "Event Specials" },
];

/** Row shape of public.fantasy_markets. */
export type FantasyMarket = {
  id: string;
  event_id: string;
  group_id: string;
  market_type: FantasyMarketType;
  subject_profile_id: string | null;
  opponent_profile_id: string | null;
  params: Record<string, unknown>;
  status: FantasyMarketStatus;
  settled_at: string | null;
};

/** Spec for a market to materialize (pre-insert). */
export type MarketSpec = {
  market_type: FantasyMarketType;
  subject_profile_id?: string | null;
  opponent_profile_id?: string | null;
  params: Record<string, unknown>;
};

export type RoundProjection = { meanGross: number; meanNet: number };

export type GenerateCtx = {
  /**
   * The full field, INCLUDING provisional (not-yet-entered) members so field
   * markets size correctly. Per-player markets skip `provisional` players until
   * they enter (their markets materialise on the next refresh).
   */
  players: { profileId: string; provisional?: boolean; playingHandicap: number }[];
  /** From a preliminary sim run — used to set O/U lines and pair matchups. */
  projections: Record<
    string,
    RoundProjection & { rounds?: Record<number, RoundProjection> }
  >;
  /** Event round numbers (length 1 for single-round events). */
  rounds: number[];
  /** Round-tagged hole set — feeds hole-specific and field-special markets. */
  holes: { holeNumber: number; par: number; round: number }[];
};

export type FinalPlayerScore = {
  profileId: string;
  /** Final leaderboard position (countback/playoff resolved); null = no result. */
  position: number | null;
  grossScore: number | null;
  netScore: number | null;
  /** Birdie-or-better holes; null = unknown. */
  birdieCount: number | null;
  /** Eagle-or-better holes; null = unknown. */
  eagleCount: number | null;
  /** Per-event-round scoring, for round-scoped markets. */
  roundScores: Record<
    number,
    { gross: number | null; net: number | null; birdies: number | null }
  >;
  /** Latest strokes per hole, keyed holeKey(round, hole); null = no hole data. */
  holeStrokes: Record<number, number> | null;
  withdrawn: boolean;
};

export type FinalScoringData = {
  players: Record<string, FinalPlayerScore>;
  fieldSize: number;
  /** Round-tagged hole set (par lookups for hole-level settlement). */
  holes: { holeNumber: number; par: number; round: number }[];
  /** Field-wide rare events, from hole-level scores; null = no hole data. */
  field: { ace: boolean | null; albatross: boolean | null; eagle: boolean | null };
};

/**
 * Live event context for placement and cash-out checks. The optional `round`
 * argument scopes the answer to one event round; omitted = event-wide.
 */
export type LiveMarketCtx = {
  eventCompleted: boolean;
  /** All the player's rounds finished (or the given round finished). */
  roundComplete: (profileId: string, round?: number) => boolean;
  /** Holes left to play (event-wide or within the round); Infinity if not started. */
  holesRemaining: (profileId: string, round?: number) => number;
  currentBirdies: (profileId: string, round?: number) => number;
  currentEagles: (profileId: string, round?: number) => number;
  /** Latest recorded strokes for a specific hole; null = not played yet. */
  holeScore: (profileId: string, round: number, holeNumber: number) => number | null;
};

export type SettlementOutcome = "won" | "lost" | "void";

export type CashoutCutoff = { eligible: true } | { eligible: false; reason: string };

/**
 * All behavior for one market type lives in its definition — settlement,
 * pricing, cash-out rules, placement locks. Nothing market-specific may be
 * hard-coded elsewhere in the app.
 */
export interface MarketDefinition {
  type: FantasyMarketType;
  /** Which board section this market renders under. */
  group: MarketGroup;
  eligibleForCashout: boolean;
  displayName(market: FantasyMarket, names: Record<string, string>): string;
  selectionLabel(
    market: FantasyMarket,
    selectionKey: string,
    names: Record<string, string>
  ): string;
  generateMarkets(ctx: GenerateCtx): MarketSpec[];
  /** Valid selection_keys for this market. */
  selections(market: FantasyMarket): string[];
  /** selection_key → raw probability (clamping happens at snapshot time). */
  simulate(sim: SimulationResult, market: FantasyMarket): Map<string, number>;
  /** selection_key → outcome, only called when scoring data exists. */
  settle(final: FinalScoringData, market: FantasyMarket): Map<string, SettlementOutcome>;
  /** May a new pick be placed on this selection right now? */
  placementAllowed(market: FantasyMarket, selectionKey: string, ctx: LiveMarketCtx): boolean;
  /**
   * Spec §4.2: cash-out is blocked when the bettor could resolve the market
   * with their own next score submission (e.g. 1+ birdie on yourself).
   */
  isSelfDependent(
    market: FantasyMarket,
    selectionKey: string,
    bettorProfileId: string,
    ctx: LiveMarketCtx
  ): boolean;
  cashoutCutoff(market: FantasyMarket, selectionKey: string, ctx: LiveMarketCtx): CashoutCutoff;
}

export function playerName(names: Record<string, string>, profileId: string | null): string {
  if (!profileId) return "Unknown";
  return names[profileId] ?? "Unknown";
}

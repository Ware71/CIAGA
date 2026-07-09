import type {
  FinalScoringData,
  FantasyMarket,
  GenerateCtx,
  LiveMarketCtx,
  MarketDefinition,
  MarketSpec,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import { playerName } from "@/lib/fantasy/markets/types";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

/** Positions offered per player: 1st .. min(field, MAX_POSITIONS). */
const MAX_POSITIONS = 8;
const MIN_FIELD = 4;

function maxPos(market: FantasyMarket): number {
  const n = Number((market.params as { maxPos?: unknown }).maxPos);
  return Number.isInteger(n) && n > 0 ? n : MAX_POSITIONS;
}

export function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/**
 * Exact finishing position — one market per player, one selection per
 * position, priced straight off the sim's position histogram. Positions
 * beyond the offered range simply lose every selection.
 */
export const finishPosition: MarketDefinition = {
  type: "finish_position",
  group: "position",
  eligibleForCashout: true,

  displayName(market, names) {
    return `${playerName(names, market.subject_profile_id)} — Finishing Position`;
  },

  selectionLabel(_market, selectionKey) {
    const n = Number(selectionKey);
    return Number.isInteger(n) ? `Exactly ${ordinal(n)}` : selectionKey;
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    if (ctx.players.length < MIN_FIELD) return [];
    const positions = Math.min(ctx.players.length, MAX_POSITIONS);
    return ctx.players.map((p) => ({
      market_type: "finish_position" as const,
      subject_profile_id: p.profileId,
      params: { maxPos: positions },
    }));
  },

  selections(market): string[] {
    return Array.from({ length: maxPos(market) }, (_, i) => String(i + 1));
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const histogram = sim.players[idx].positionHistogram;
    for (let pos = 1; pos <= maxPos(market); pos++) {
      out.set(String(pos), histogram[pos - 1] ?? 0);
    }
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    for (let pos = 1; pos <= maxPos(market); pos++) {
      if (!player || player.withdrawn || player.position == null) {
        out.set(String(pos), "void");
      } else {
        out.set(String(pos), player.position === pos ? "won" : "lost");
      }
    }
    return out;
  },

  placementAllowed(market, _selectionKey, ctx: LiveMarketCtx): boolean {
    const subject = market.subject_profile_id;
    return !ctx.eventCompleted && !!subject && !ctx.roundComplete(subject);
  },

  isSelfDependent(): boolean {
    // Position depends on the whole field, not just the bettor's own entry.
    return false;
  },

  cashoutCutoff(market, _selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    const subject = market.subject_profile_id;
    if (!subject || ctx.roundComplete(subject)) {
      return { eligible: false, reason: "Player's round is complete" };
    }
    return { eligible: true };
  },
};

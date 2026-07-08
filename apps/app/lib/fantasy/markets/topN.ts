import type {
  FantasyMarket,
  FinalScoringData,
  GenerateCtx,
  LiveMarketCtx,
  MarketDefinition,
  MarketSpec,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import { playerName } from "@/lib/fantasy/markets/types";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

function marketN(market: FantasyMarket): number {
  const n = Number((market.params as { n?: unknown }).n);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

/** Minimum field size for each top-N market to be meaningful. */
const MIN_FIELD: Record<number, number> = { 3: 5, 5: 8, 10: 14 };

/** Top-N finish — one market per N, selections are the field. */
export const topN: MarketDefinition = {
  type: "top_n",
  eligibleForCashout: true,

  displayName(market) {
    return `Top ${marketN(market)} Finish`;
  },

  selectionLabel(_market, selectionKey, names) {
    return playerName(names, selectionKey);
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    const specs: MarketSpec[] = [];
    for (const n of [3, 5, 10]) {
      if (ctx.players.length >= (MIN_FIELD[n] ?? Infinity)) {
        specs.push({ market_type: "top_n", params: { n } });
      }
    }
    return specs;
  },

  selections(): string[] {
    return []; // field-wide, enumerated from the sim result
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const n = marketN(market);
    const out = new Map<string, number>();
    for (const p of sim.players) out.set(p.profileId, p.topNProb[n] ?? 0);
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const n = marketN(market);
    const out = new Map<string, SettlementOutcome>();
    for (const p of Object.values(final.players)) {
      if (p.withdrawn || p.position == null) out.set(p.profileId, "void");
      else out.set(p.profileId, p.position <= n ? "won" : "lost");
    }
    return out;
  },

  placementAllowed(_market, selectionKey, ctx: LiveMarketCtx): boolean {
    return !ctx.eventCompleted && !ctx.roundComplete(selectionKey);
  },

  isSelfDependent(): boolean {
    return false;
  },

  cashoutCutoff(_market, selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    if (ctx.roundComplete(selectionKey)) {
      return { eligible: false, reason: "Player's round is complete" };
    }
    return { eligible: true };
  },
};

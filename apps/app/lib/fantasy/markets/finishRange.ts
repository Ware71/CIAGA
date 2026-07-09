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
import { ordinal } from "@/lib/fantasy/markets/finishPosition";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

type RangeParams = { kind?: "last"; from?: number; to?: number };

function rangeParams(market: FantasyMarket): RangeParams {
  return market.params as RangeParams;
}

/**
 * Position-range markets — field-wide (selections are the players):
 *  - Wooden spoon (finish last; bottom ties all count, mirroring the outright)
 *  - Bottom 3
 *  - Mid-pack (4th–6th) for bigger fields
 * Priced from the sim's position histogram / lastProb.
 */
export const finishRange: MarketDefinition = {
  type: "finish_range",
  group: "position",
  eligibleForCashout: true,

  displayName(market) {
    const p = rangeParams(market);
    if (p.kind === "last") return "Wooden Spoon (Last Place)";
    if (p.from != null && p.to != null) return `Finish ${ordinal(p.from)}–${ordinal(p.to)}`;
    return "Finishing Range";
  },

  selectionLabel(_market, selectionKey, names) {
    return playerName(names, selectionKey);
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    const n = ctx.players.length;
    const specs: MarketSpec[] = [];
    if (n >= 4) specs.push({ market_type: "finish_range", params: { kind: "last" } });
    if (n >= 7) specs.push({ market_type: "finish_range", params: { from: n - 2, to: n } });
    if (n >= 9) specs.push({ market_type: "finish_range", params: { from: 4, to: 6 } });
    return specs;
  },

  selections(): string[] {
    return []; // field-wide, enumerated from the sim result
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const p = rangeParams(market);
    for (const player of sim.players) {
      if (p.kind === "last") {
        out.set(player.profileId, player.lastProb);
      } else {
        const from = Math.max(1, p.from ?? 1);
        const to = Math.min(player.positionHistogram.length, p.to ?? from);
        let sum = 0;
        for (let pos = from; pos <= to; pos++) sum += player.positionHistogram[pos - 1] ?? 0;
        out.set(player.profileId, sum);
      }
    }
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const p = rangeParams(market);
    const positions = Object.values(final.players)
      .filter((pl) => !pl.withdrawn && pl.position != null)
      .map((pl) => pl.position as number);
    const worst = positions.length > 0 ? Math.max(...positions) : null;
    for (const player of Object.values(final.players)) {
      if (player.withdrawn || player.position == null) {
        out.set(player.profileId, "void");
        continue;
      }
      const won =
        p.kind === "last"
          ? worst != null && player.position === worst
          : p.from != null && p.to != null && player.position >= p.from && player.position <= p.to;
      out.set(player.profileId, won ? "won" : "lost");
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

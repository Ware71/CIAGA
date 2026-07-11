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
import { countDistribution } from "@/lib/fantasy/markets/roundUtil";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

function marketCount(market: FantasyMarket): number {
  const count = Number((market.params as { count?: unknown }).count);
  return Number.isInteger(count) && count > 0 ? count : 1;
}

/**
 * Player to make N+ eagles (or better) anywhere in the event. Back-only.
 * Priced from the calibrated eagle-or-better bins (holeModel calibrates the
 * k=0 mass against the player's observed eagles/round, so the normal tail
 * can't overstate this rare outcome). Played holes are deterministic in the
 * bins, so an already-made eagle prices at the ceiling.
 */
export const eagleCount: MarketDefinition = {
  type: "eagle_count",
  group: "birdies",
  eligibleForCashout: true,

  displayName(market, names) {
    const count = marketCount(market);
    return `${playerName(names, market.subject_profile_id)} to make ${count}+ eagle${count > 1 ? "s" : ""}`;
  },

  selectionLabel() {
    return "Yes";
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    return ctx.players.filter((p) => !p.provisional).flatMap((p) =>
      [1, 2, 3].map((count) => ({
        market_type: "eagle_count" as const,
        subject_profile_id: p.profileId,
        params: { count },
      }))
    );
  },

  selections(): string[] {
    return ["yes"];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const count = marketCount(market);
    // Holes are independent in the model: P(≥N) from the per-hole eagle-bin
    // count distribution (same convolution birdies.ts uses for its N+ counts).
    const perHole = sim.players[idx].holeOutcomes.map((bins) => bins[0] / sim.simulationCount);
    const dist = countDistribution(perHole);
    let atLeast = 0;
    for (let k = count; k < dist.length; k++) atLeast += dist[k];
    out.set("yes", atLeast);
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const count = marketCount(market);
    if (player?.eagleCount != null && player.eagleCount >= count) {
      // Achieved — a later withdrawal can't undo made eagles.
      out.set("yes", "won");
    } else if (!player || player.withdrawn || player.eagleCount == null) {
      out.set("yes", "void");
    } else {
      out.set("yes", "lost");
    }
    return out;
  },

  placementAllowed(market, _selectionKey, ctx: LiveMarketCtx): boolean {
    if (ctx.eventCompleted) return false;
    const subject = market.subject_profile_id;
    if (!subject || ctx.roundComplete(subject)) return false;
    return ctx.currentEagles(subject) < marketCount(market);
  },

  isSelfDependent(market, _selectionKey, bettorProfileId, ctx): boolean {
    if (market.subject_profile_id !== bettorProfileId) return false;
    // One more eagle resolves it — the bettor's own next score could decide.
    return marketCount(market) - ctx.currentEagles(bettorProfileId) <= 1;
  },

  cashoutCutoff(market, _selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    const subject = market.subject_profile_id;
    if (!subject || ctx.roundComplete(subject)) {
      return { eligible: false, reason: "Player's round is complete" };
    }
    if (ctx.currentEagles(subject) >= marketCount(market)) {
      return { eligible: false, reason: "Market already decided" };
    }
    return { eligible: true };
  },
};

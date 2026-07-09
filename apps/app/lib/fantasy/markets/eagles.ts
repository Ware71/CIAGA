import type {
  FinalScoringData,
  GenerateCtx,
  LiveMarketCtx,
  MarketDefinition,
  MarketSpec,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import { playerName } from "@/lib/fantasy/markets/types";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

/**
 * Player to make an eagle (or better) anywhere in the event. Back-only.
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
    return `${playerName(names, market.subject_profile_id)} to make an eagle`;
  },

  selectionLabel() {
    return "Yes";
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    return ctx.players.map((p) => ({
      market_type: "eagle_count" as const,
      subject_profile_id: p.profileId,
      params: { count: 1 },
    }));
  },

  selections(): string[] {
    return ["yes"];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    // Holes are independent in the model: P(≥1) = 1 − Π(1 − p_hole).
    let noEagle = 1;
    for (const bins of sim.players[idx].holeOutcomes) {
      noEagle *= 1 - bins[0] / sim.simulationCount;
    }
    out.set("yes", 1 - noEagle);
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    if (player?.eagleCount != null && player.eagleCount >= 1) {
      // Achieved — a later withdrawal can't undo a made eagle.
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
    return ctx.currentEagles(subject) < 1;
  },

  isSelfDependent(market, _selectionKey, bettorProfileId, ctx): boolean {
    if (market.subject_profile_id !== bettorProfileId) return false;
    // Any of the bettor's own remaining holes could be the eagle.
    return 1 - ctx.currentEagles(bettorProfileId) <= 1;
  },

  cashoutCutoff(market, _selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    const subject = market.subject_profile_id;
    if (!subject || ctx.roundComplete(subject)) {
      return { eligible: false, reason: "Player's round is complete" };
    }
    if (ctx.currentEagles(subject) >= 1) {
      return { eligible: false, reason: "Market already decided" };
    }
    return { eligible: true };
  },
};

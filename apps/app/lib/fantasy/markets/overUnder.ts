import type {
  FantasyMarket,
  FantasyMarketType,
  FinalScoringData,
  GenerateCtx,
  LiveMarketCtx,
  MarketDefinition,
  MarketSpec,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import { playerName } from "@/lib/fantasy/markets/types";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

function marketLine(market: FantasyMarket): number {
  const line = Number((market.params as { line?: unknown }).line);
  return Number.isFinite(line) ? line : 0;
}

/**
 * Gross/net score over-under. One market per player; the line is set at
 * generation time to the player's projected mean (x.5 → no pushes) and stays
 * fixed while the odds re-price in play.
 */
function makeOverUnder(type: Extract<FantasyMarketType, "gross_ou" | "net_ou">): MarketDefinition {
  const basis = type === "gross_ou" ? "gross" : "net";

  return {
    type,
    group: "scoring",
    eligibleForCashout: true,

    displayName(market, names) {
      return `${playerName(names, market.subject_profile_id)} ${basis} score`;
    },

    selectionLabel(market, selectionKey) {
      const line = marketLine(market);
      return selectionKey === "under" ? `Under ${line}` : `Over ${line}`;
    },

    generateMarkets(ctx: GenerateCtx): MarketSpec[] {
      return ctx.players.flatMap((p) => {
        const projection = ctx.projections[p.profileId];
        if (!projection) return [];
        const mean = basis === "gross" ? projection.meanGross : projection.meanNet;
        if (!Number.isFinite(mean)) return [];
        const line = Math.floor(mean) + 0.5;
        return [{ market_type: type, subject_profile_id: p.profileId, params: { line } }];
      });
    },

    selections(): string[] {
      return ["under", "over"];
    },

    simulate(sim: SimulationResult, market): Map<string, number> {
      const out = new Map<string, number>();
      const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
      if (idx === undefined) return out;
      const totals = basis === "gross" ? sim.players[idx].grossTotals : sim.players[idx].netTotals;
      const line = marketLine(market);
      let under = 0;
      for (let i = 0; i < totals.length; i++) {
        if (totals[i] < line) under += 1;
      }
      const pUnder = under / sim.simulationCount;
      out.set("under", pUnder);
      out.set("over", 1 - pUnder);
      return out;
    },

    settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
      const out = new Map<string, SettlementOutcome>();
      const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
      const score = basis === "gross" ? player?.grossScore : player?.netScore;
      if (!player || player.withdrawn || score == null) {
        out.set("under", "void");
        out.set("over", "void");
        return out;
      }
      const line = marketLine(market);
      out.set("under", score < line ? "won" : "lost");
      out.set("over", score > line ? "won" : "lost");
      return out;
    },

    placementAllowed(market, _selectionKey, ctx: LiveMarketCtx): boolean {
      if (ctx.eventCompleted) return false;
      const subject = market.subject_profile_id;
      return !!subject && !ctx.roundComplete(subject);
    },

    isSelfDependent(market, _selectionKey, bettorProfileId, ctx): boolean {
      // The bettor's own final score entry decides the market — block cash-out
      // once their next submission could resolve it.
      if (market.subject_profile_id !== bettorProfileId) return false;
      return ctx.holesRemaining(bettorProfileId) <= 1;
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
}

export const grossOverUnder = makeOverUnder("gross_ou");
export const netOverUnder = makeOverUnder("net_ou");

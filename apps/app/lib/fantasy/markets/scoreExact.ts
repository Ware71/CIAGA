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

const SPREAD = 4; // projection ± SPREAD exact scores offered

function marketScores(market: FantasyMarket): number[] {
  const scores = (market.params as { scores?: unknown }).scores;
  return Array.isArray(scores) ? scores.map(Number).filter(Number.isInteger) : [];
}

/**
 * Exact gross score — the longshot market. One per player; selections are the
 * nine scores around the projection. Anything outside the range loses every
 * selection (no "other" bucket, mirroring how books shape correct-score).
 */
export const scoreExact: MarketDefinition = {
  type: "score_exact",
  group: "scoring",
  eligibleForCashout: true,

  displayName(market, names) {
    return `${playerName(names, market.subject_profile_id)} exact gross score`;
  },

  selectionLabel(_market, selectionKey) {
    return `Exactly ${selectionKey}`;
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    return ctx.players.flatMap((p) => {
      const projection = ctx.projections[p.profileId];
      if (!projection || !Number.isFinite(projection.meanGross)) return [];
      const c = Math.round(projection.meanGross);
      const scores = Array.from({ length: SPREAD * 2 + 1 }, (_, i) => c - SPREAD + i);
      return [
        {
          market_type: "score_exact" as const,
          subject_profile_id: p.profileId,
          params: { basis: "gross", scores },
        },
      ];
    });
  },

  selections(market): string[] {
    return marketScores(market).map(String);
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const totals = sim.players[idx].grossTotals;
    for (const score of marketScores(market)) {
      let hits = 0;
      for (let i = 0; i < totals.length; i++) {
        if (totals[i] === score) hits += 1;
      }
      out.set(String(score), hits / sim.simulationCount);
    }
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    for (const score of marketScores(market)) {
      if (!player || player.withdrawn || player.grossScore == null) {
        out.set(String(score), "void");
      } else {
        out.set(String(score), player.grossScore === score ? "won" : "lost");
      }
    }
    return out;
  },

  placementAllowed(market, _selectionKey, ctx: LiveMarketCtx): boolean {
    if (ctx.eventCompleted) return false;
    const subject = market.subject_profile_id;
    return !!subject && !ctx.roundComplete(subject);
  },

  isSelfDependent(market, _selectionKey, bettorProfileId, ctx): boolean {
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

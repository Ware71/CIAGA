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
import {
  countDistribution,
  holeIdxsForRound,
  marketRound,
  roundPrefix,
} from "@/lib/fantasy/markets/roundUtil";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

function marketCount(market: FantasyMarket): number {
  const count = Number((market.params as { count?: unknown }).count);
  return Number.isInteger(count) && count > 0 ? count : 1;
}

/**
 * Player to make N+ birdies (birdie-or-better holes). Back-only ('yes').
 * The 1+ variant on yourself is the spec's canonical self-dependent market:
 * you could make a birdie and choose when to record it, so cash-out is
 * blocked whenever your own next score entry could resolve the market.
 */
export const birdies: MarketDefinition = {
  type: "birdies",
  group: "birdies",
  eligibleForCashout: true,

  displayName(market, names) {
    const count = marketCount(market);
    return `${roundPrefix(market)}${playerName(names, market.subject_profile_id)} to make ${count}+ birdie${count > 1 ? "s" : ""}`;
  },

  selectionLabel() {
    return "Yes";
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    return ctx.players.flatMap((p) => {
      const specs: MarketSpec[] = [1, 2, 3, 4].map((count) => ({
        market_type: "birdies" as const,
        subject_profile_id: p.profileId,
        params: { count },
      }));
      if (ctx.rounds.length > 1) {
        for (const round of ctx.rounds) {
          for (const count of [1, 2, 3]) {
            specs.push({
              market_type: "birdies",
              subject_profile_id: p.profileId,
              params: { count, round },
            });
          }
        }
      }
      return specs;
    });
  },

  selections(): string[] {
    return ["yes"];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const count = marketCount(market);
    const round = marketRound(market);
    if (round == null) {
      const histogram = sim.players[idx].birdieHistogram;
      let atLeast = 0;
      for (let c = count; c < histogram.length; c++) atLeast += histogram[c];
      out.set("yes", atLeast / sim.simulationCount);
      return out;
    }
    // Round-scoped: exact count distribution from the round's per-hole
    // birdie-or-better probabilities (holes are independent in the model, so
    // this matches joint sampling; played holes contribute 0/1).
    const perHole = holeIdxsForRound(sim, round).map((hi) => {
      const bins = sim.players[idx].holeOutcomes[hi];
      return (bins[0] + bins[1]) / sim.simulationCount;
    });
    const dist = countDistribution(perHole);
    let atLeast = 0;
    for (let c = count; c < dist.length; c++) atLeast += dist[c];
    out.set("yes", atLeast);
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const count = marketCount(market);
    const round = marketRound(market);
    const birdies = round != null ? player?.roundScores[round]?.birdies : player?.birdieCount;
    if (player && birdies != null && birdies >= count) {
      // Already achieved — a later withdrawal can't undo made birdies.
      out.set("yes", "won");
    } else if (!player || player.withdrawn || birdies == null) {
      out.set("yes", "void");
    } else {
      out.set("yes", "lost");
    }
    return out;
  },

  placementAllowed(market, _selectionKey, ctx: LiveMarketCtx): boolean {
    if (ctx.eventCompleted) return false;
    const subject = market.subject_profile_id;
    const round = marketRound(market) ?? undefined;
    if (!subject || ctx.roundComplete(subject, round)) return false;
    // Already-won markets would price at the ceiling — nothing to bet on.
    return ctx.currentBirdies(subject, round) < marketCount(market);
  },

  isSelfDependent(market, _selectionKey, bettorProfileId, ctx): boolean {
    if (market.subject_profile_id !== bettorProfileId) return false;
    // One more birdie resolves it → the bettor's own next score could decide.
    const round = marketRound(market) ?? undefined;
    return marketCount(market) - ctx.currentBirdies(bettorProfileId, round) <= 1;
  },

  cashoutCutoff(market, _selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    const subject = market.subject_profile_id;
    const round = marketRound(market) ?? undefined;
    if (!subject || ctx.roundComplete(subject, round)) {
      return { eligible: false, reason: "Player's round is complete" };
    }
    if (ctx.currentBirdies(subject, round) >= marketCount(market)) {
      return { eligible: false, reason: "Market already decided" };
    }
    return { eligible: true };
  },
};

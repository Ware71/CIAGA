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
import { marketRound, roundPrefix, totalsFor, winProbsFrom } from "@/lib/fantasy/markets/roundUtil";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

/**
 * Outright winner — one market per event, selections are the field.
 * Multi-round events additionally get one per round ("Round 2 Winner"),
 * priced from that round's joint samples on the event's ranking basis.
 */
export const outrightWinner: MarketDefinition = {
  type: "outright_winner",
  group: "winner",
  eligibleForCashout: true,

  displayName(market) {
    const round = marketRound(market);
    return round != null ? `Round ${round} Winner` : "Outright Winner";
  },

  selectionLabel(_market, selectionKey, names) {
    return playerName(names, selectionKey);
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    if (ctx.players.length < 2) return [];
    const specs: MarketSpec[] = [{ market_type: "outright_winner", params: {} }];
    if (ctx.rounds.length > 1) {
      for (const round of ctx.rounds) {
        specs.push({ market_type: "outright_winner", params: { round } });
      }
    }
    return specs;
  },

  selections(): string[] {
    // Selections are the event field; enumerated by the odds service from the
    // sim result rather than stored on the market row.
    return [];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const round = marketRound(market);
    if (round == null) {
      for (const p of sim.players) out.set(p.profileId, p.winProb);
      return out;
    }
    const totals = sim.players.map((_, pi) =>
      totalsFor(sim, pi, sim.rankingBasis, round)
    );
    const probs = winProbsFrom(totals, sim.simulationCount);
    sim.players.forEach((p, pi) => out.set(p.profileId, probs[pi]));
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const round = marketRound(market);
    if (round == null) {
      for (const p of Object.values(final.players)) {
        if (p.withdrawn) out.set(p.profileId, "void");
        else if (p.position == null) out.set(p.profileId, "void");
        else out.set(p.profileId, p.position === 1 ? "won" : "lost");
      }
      return out;
    }
    // Round winner: best score of the round on the ranking basis; net when a
    // net score exists, otherwise gross. Ties all win (no round playoffs).
    const scores = new Map<string, number>();
    for (const p of Object.values(final.players)) {
      const rs = p.roundScores[round];
      const score = rs?.net ?? rs?.gross;
      if (score != null && !p.withdrawn) scores.set(p.profileId, score);
    }
    const best = scores.size > 0 ? Math.min(...scores.values()) : null;
    for (const p of Object.values(final.players)) {
      const mine = scores.get(p.profileId);
      if (mine == null || best == null) out.set(p.profileId, "void");
      else out.set(p.profileId, mine === best ? "won" : "lost");
    }
    return out;
  },

  placementAllowed(market, selectionKey, ctx: LiveMarketCtx): boolean {
    // In-play picks allowed; a player whose round is done is a dead pick, so
    // block backing them (their odds are frozen while others still move).
    const round = marketRound(market) ?? undefined;
    return !ctx.eventCompleted && !ctx.roundComplete(selectionKey, round);
  },

  isSelfDependent(): boolean {
    // Spec: outright picks on yourself are allowed and cash-out eligible.
    return false;
  },

  cashoutCutoff(market, selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    const round = marketRound(market) ?? undefined;
    if (ctx.roundComplete(selectionKey, round)) {
      return { eligible: false, reason: "Player's round is complete" };
    }
    return { eligible: true };
  },
};

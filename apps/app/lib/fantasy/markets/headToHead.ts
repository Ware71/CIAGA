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
import { marketRound, roundPrefix, totalsFor } from "@/lib/fantasy/markets/roundUtil";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

function marketBasis(market: FantasyMarket): "gross" | "net" {
  return (market.params as { basis?: unknown }).basis === "net" ? "net" : "gross";
}

/**
 * Head-to-head matchups (A beats B, gross or net). Rather than every pair
 * (O(n²) markets), players are paired with their nearest projected rival —
 * sorted by projected mean, adjacent pairs — separately for gross and net.
 * Ties settle as void (stake refunded), so the fair price is the
 * TIE-EXCLUDED conditional P(A wins | not a tie) — crediting half the tie
 * mass to each side (the old pricing) shades value toward the favorite,
 * because a tie returns the stake rather than paying half.
 */
export const headToHead: MarketDefinition = {
  type: "h2h",
  group: "match",
  eligibleForCashout: true,

  displayName(market, names) {
    const a = playerName(names, market.subject_profile_id);
    const b = playerName(names, market.opponent_profile_id);
    return `${roundPrefix(market)}${a} v ${b} (${marketBasis(market)})`;
  },

  selectionLabel(market, selectionKey, names) {
    return selectionKey === "a"
      ? playerName(names, market.subject_profile_id)
      : playerName(names, market.opponent_profile_id);
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    const specs: MarketSpec[] = [];
    for (const basis of ["gross", "net"] as const) {
      const sorted = ctx.players
        .filter((p) => ctx.projections[p.profileId] && !p.provisional)
        .sort((x, y) => {
          const px = ctx.projections[x.profileId];
          const py = ctx.projections[y.profileId];
          return basis === "gross"
            ? px.meanGross - py.meanGross
            : px.meanNet - py.meanNet;
        });
      for (let i = 0; i + 1 < sorted.length; i += 2) {
        specs.push({
          market_type: "h2h",
          subject_profile_id: sorted[i].profileId,
          opponent_profile_id: sorted[i + 1].profileId,
          params: { basis },
        });
        // Same nearest-rival pairing per round for multi-round events.
        if (ctx.rounds.length > 1) {
          for (const round of ctx.rounds) {
            specs.push({
              market_type: "h2h",
              subject_profile_id: sorted[i].profileId,
              opponent_profile_id: sorted[i + 1].profileId,
              params: { basis, round },
            });
          }
        }
      }
    }
    return specs;
  },

  selections(): string[] {
    return ["a", "b"];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const ia = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    const ib = market.opponent_profile_id ? sim.playerIndex[market.opponent_profile_id] : undefined;
    if (ia === undefined || ib === undefined) return out;
    const basis = marketBasis(market);
    const round = marketRound(market);
    const totalsA = totalsFor(sim, ia, basis, round);
    const totalsB = totalsFor(sim, ib, basis, round);
    let winsA = 0;
    let ties = 0;
    for (let i = 0; i < totalsA.length; i++) {
      if (totalsA[i] < totalsB[i]) winsA += 1;
      else if (totalsA[i] === totalsB[i]) ties += 1;
    }
    // Ties void the market (stake back), so price on the decided iterations
    // only. Sides still sum to 1.
    const decided = sim.simulationCount - ties;
    const pA = decided > 0 ? winsA / decided : 0.5;
    out.set("a", pA);
    out.set("b", 1 - pA);
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const basis = marketBasis(market);
    const round = marketRound(market);
    const a = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const b = market.opponent_profile_id ? final.players[market.opponent_profile_id] : undefined;
    const scoreOf = (p: typeof a): number | null | undefined =>
      round != null
        ? basis === "gross"
          ? p?.roundScores[round]?.gross
          : p?.roundScores[round]?.net
        : basis === "gross"
        ? p?.grossScore
        : p?.netScore;
    const scoreA = scoreOf(a);
    const scoreB = scoreOf(b);
    if (!a || !b || a.withdrawn || b.withdrawn || scoreA == null || scoreB == null || scoreA === scoreB) {
      out.set("a", "void");
      out.set("b", "void");
      return out;
    }
    out.set("a", scoreA < scoreB ? "won" : "lost");
    out.set("b", scoreB < scoreA ? "won" : "lost");
    return out;
  },

  placementAllowed(market, _selectionKey, ctx: LiveMarketCtx): boolean {
    if (ctx.eventCompleted) return false;
    const a = market.subject_profile_id;
    const b = market.opponent_profile_id;
    const round = marketRound(market) ?? undefined;
    return !!a && !!b && !(ctx.roundComplete(a, round) && ctx.roundComplete(b, round));
  },

  isSelfDependent(market, _selectionKey, bettorProfileId, ctx): boolean {
    // Spec allows matchup cash-outs, except the generic rule: if the bettor is
    // in the matchup, the other side has finished, and the bettor's next score
    // entry could decide it, the market is self-resolvable.
    const a = market.subject_profile_id;
    const b = market.opponent_profile_id;
    if (bettorProfileId !== a && bettorProfileId !== b) return false;
    const other = bettorProfileId === a ? b : a;
    if (!other) return false;
    const round = marketRound(market) ?? undefined;
    return ctx.roundComplete(other, round) && ctx.holesRemaining(bettorProfileId, round) <= 1;
  },

  cashoutCutoff(market, _selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    const a = market.subject_profile_id;
    const b = market.opponent_profile_id;
    const round = marketRound(market) ?? undefined;
    if (!a || !b || (ctx.roundComplete(a, round) && ctx.roundComplete(b, round))) {
      return { eligible: false, reason: "Both rounds are complete" };
    }
    return { eligible: true };
  },
};

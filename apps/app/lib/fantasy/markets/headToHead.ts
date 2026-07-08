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

function marketBasis(market: FantasyMarket): "gross" | "net" {
  return (market.params as { basis?: unknown }).basis === "net" ? "net" : "gross";
}

/**
 * Head-to-head matchups (A beats B, gross or net). Rather than every pair
 * (O(n²) markets), players are paired with their nearest projected rival —
 * sorted by projected mean, adjacent pairs — separately for gross and net.
 * Ties settle as void (stake refunded); pricing gives half the tie mass to
 * each side.
 */
export const headToHead: MarketDefinition = {
  type: "h2h",
  group: "match",
  eligibleForCashout: true,

  displayName(market, names) {
    const a = playerName(names, market.subject_profile_id);
    const b = playerName(names, market.opponent_profile_id);
    return `${a} v ${b} (${marketBasis(market)})`;
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
        .filter((p) => ctx.projections[p.profileId])
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
    const totalsA = basis === "gross" ? sim.players[ia].grossTotals : sim.players[ia].netTotals;
    const totalsB = basis === "gross" ? sim.players[ib].grossTotals : sim.players[ib].netTotals;
    let winsA = 0;
    let ties = 0;
    for (let i = 0; i < totalsA.length; i++) {
      if (totalsA[i] < totalsB[i]) winsA += 1;
      else if (totalsA[i] === totalsB[i]) ties += 1;
    }
    const pA = (winsA + ties / 2) / sim.simulationCount;
    out.set("a", pA);
    out.set("b", 1 - pA);
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const basis = marketBasis(market);
    const a = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const b = market.opponent_profile_id ? final.players[market.opponent_profile_id] : undefined;
    const scoreA = basis === "gross" ? a?.grossScore : a?.netScore;
    const scoreB = basis === "gross" ? b?.grossScore : b?.netScore;
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
    return !!a && !!b && !(ctx.roundComplete(a) && ctx.roundComplete(b));
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
    return ctx.roundComplete(other) && ctx.holesRemaining(bettorProfileId) <= 1;
  },

  cashoutCutoff(market, _selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    const a = market.subject_profile_id;
    const b = market.opponent_profile_id;
    if (!a || !b || (ctx.roundComplete(a) && ctx.roundComplete(b))) {
      return { eligible: false, reason: "Both rounds are complete" };
    }
    return { eligible: true };
  },
};

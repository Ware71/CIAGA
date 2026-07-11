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
import { handicapImpliedScore } from "@/lib/fantasy/markets/roundUtil";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

const SPREAD = 4; // handicap-implied score ± SPREAD score values offered

type Basis = "gross" | "net";

function marketBasis(market: FantasyMarket): Basis {
  return (market.params as { basis?: unknown }).basis === "net" ? "net" : "gross";
}

function marketScores(market: FantasyMarket): number[] {
  const scores = (market.params as { scores?: unknown }).scores;
  return Array.isArray(scores) ? scores.map(Number).filter(Number.isInteger) : [];
}

function parseKey(selectionKey: string): { side: "u" | "e" | "o"; value: number } | null {
  const m = /^(u|e|o)_(-?\d+)$/.exec(selectionKey);
  if (!m) return null;
  return { side: m[1] as "u" | "e" | "o", value: Number(m[2]) };
}

/**
 * Score totals — one market per (player, gross|net). Replaces the old
 * separate over/under line and exact-score markets: for each of the ~9 score
 * values, offers a three-way Under / Exactly / Over split instead of a single
 * fixed .5 line. Selection keys: u_{v} / e_{v} / o_{v}. Event-wide only (no
 * round variant), mirroring the old score_exact. Values are centred on the
 * player's HANDICAP-IMPLIED score (par + playing handicap + POPULATION_GAP
 * from the event setup), not the model's own projection — the actual odds
 * still come from the real simulated distribution.
 */
export const scoreTotal: MarketDefinition = {
  type: "score_total",
  group: "scoring",
  eligibleForCashout: true,

  displayName(market, names) {
    return `${playerName(names, market.subject_profile_id)} ${marketBasis(market)} score`;
  },

  selectionLabel(_market, selectionKey) {
    const parsed = parseKey(selectionKey);
    if (!parsed) return selectionKey;
    if (parsed.side === "u") return `Under ${parsed.value}`;
    if (parsed.side === "o") return `Over ${parsed.value}`;
    return `Exactly ${parsed.value}`;
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    return ctx.players.filter((p) => !p.provisional).flatMap((p) => {
      const specs: MarketSpec[] = [];
      for (const basis of ["gross", "net"] as const) {
        const mean = handicapImpliedScore(ctx, p.playingHandicap, basis);
        if (mean == null) continue;
        const c = Math.round(mean);
        const scores = Array.from({ length: SPREAD * 2 + 1 }, (_, i) => c - SPREAD + i);
        specs.push({
          market_type: "score_total" as const,
          subject_profile_id: p.profileId,
          params: { basis, scores },
        });
      }
      return specs;
    });
  },

  selections(market): string[] {
    return marketScores(market).flatMap((v) => [`u_${v}`, `e_${v}`, `o_${v}`]);
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const basis = marketBasis(market);
    const totals = basis === "gross" ? sim.players[idx].grossTotals : sim.players[idx].netTotals;
    for (const v of marketScores(market)) {
      let under = 0;
      let exact = 0;
      let over = 0;
      for (let i = 0; i < totals.length; i++) {
        if (totals[i] < v) under += 1;
        else if (totals[i] === v) exact += 1;
        else over += 1;
      }
      out.set(`u_${v}`, under / sim.simulationCount);
      out.set(`e_${v}`, exact / sim.simulationCount);
      out.set(`o_${v}`, over / sim.simulationCount);
    }
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const basis = marketBasis(market);
    const score = basis === "gross" ? player?.grossScore : player?.netScore;
    for (const v of marketScores(market)) {
      if (!player || player.withdrawn || score == null) {
        out.set(`u_${v}`, "void");
        out.set(`e_${v}`, "void");
        out.set(`o_${v}`, "void");
        continue;
      }
      out.set(`u_${v}`, score < v ? "won" : "lost");
      out.set(`e_${v}`, score === v ? "won" : "lost");
      out.set(`o_${v}`, score > v ? "won" : "lost");
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

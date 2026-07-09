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

export type Band = { key: string; lo: number | null; hi: number | null };

type BandParams = { basis?: "gross" | "net"; bands?: Band[] };

function marketBasis(market: FantasyMarket): "gross" | "net" {
  return (market.params as BandParams).basis === "net" ? "net" : "gross";
}

function marketBands(market: FantasyMarket): Band[] {
  const bands = (market.params as BandParams).bands;
  return Array.isArray(bands) ? bands : [];
}

/** 4-stroke bands centred on the projection, with open tails. */
export function bandsAround(mean: number): Band[] {
  const c = Math.round(mean);
  return [
    { key: `le_${c - 3}`, lo: null, hi: c - 3 },
    { key: `${c - 2}_${c + 1}`, lo: c - 2, hi: c + 1 },
    { key: `${c + 2}_${c + 5}`, lo: c + 2, hi: c + 5 },
    { key: `ge_${c + 6}`, lo: c + 6, hi: null },
  ];
}

export function bandLabel(band: Band): string {
  if (band.lo == null && band.hi != null) return `${band.hi} or less`;
  if (band.hi == null && band.lo != null) return `${band.lo} or more`;
  return `${band.lo}–${band.hi}`;
}

function inBand(score: number, band: Band): boolean {
  if (band.lo != null && score < band.lo) return false;
  if (band.hi != null && score > band.hi) return false;
  return true;
}

/**
 * Score bands — one market per player per basis; selections are the bands
 * (fixed at generation, like O/U lines), so exactly one band wins.
 */
export const scoreBand: MarketDefinition = {
  type: "score_band",
  group: "scoring",
  eligibleForCashout: true,

  displayName(market, names) {
    return `${playerName(names, market.subject_profile_id)} ${marketBasis(market)} score band`;
  },

  selectionLabel(market, selectionKey) {
    const band = marketBands(market).find((b) => b.key === selectionKey);
    return band ? bandLabel(band) : selectionKey;
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    return ctx.players.flatMap((p) => {
      const projection = ctx.projections[p.profileId];
      if (!projection) return [];
      const specs: MarketSpec[] = [];
      for (const basis of ["gross", "net"] as const) {
        const mean = basis === "gross" ? projection.meanGross : projection.meanNet;
        if (!Number.isFinite(mean)) continue;
        specs.push({
          market_type: "score_band",
          subject_profile_id: p.profileId,
          params: { basis, bands: bandsAround(mean) },
        });
      }
      return specs;
    });
  },

  selections(market): string[] {
    return marketBands(market).map((b) => b.key);
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const basis = marketBasis(market);
    const totals = basis === "gross" ? sim.players[idx].grossTotals : sim.players[idx].netTotals;
    for (const band of marketBands(market)) {
      let hits = 0;
      for (let i = 0; i < totals.length; i++) {
        if (inBand(totals[i], band)) hits += 1;
      }
      out.set(band.key, hits / sim.simulationCount);
    }
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const basis = marketBasis(market);
    const score = basis === "gross" ? player?.grossScore : player?.netScore;
    for (const band of marketBands(market)) {
      if (!player || player.withdrawn || score == null) out.set(band.key, "void");
      else out.set(band.key, inBand(score, band) ? "won" : "lost");
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

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
import { handicapImpliedScore } from "@/lib/fantasy/markets/roundUtil";
import { analyticDistributions, pmfBandProbability } from "@/lib/fantasy/markets/analytic";
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

/**
 * Two 4-stroke inner bands with open tails, centred on the projection. The
 * junction between the two inner bands sits at ≈ `mean`, so a distribution
 * centred on the projection splits evenly across them (the old `[c−2, c+1]`
 * anchor put the projection at a band's upper edge, skewing the split).
 */
export function bandsAround(mean: number): Band[] {
  // c chosen so the inner region [c−3, c+4] straddles `mean` symmetrically
  // (its centre c+0.5 ≈ mean); even-width bands can't centre on one integer.
  const c = Math.round(mean - 0.5);
  return [
    { key: `le_${c - 4}`, lo: null, hi: c - 4 },
    { key: `${c - 3}_${c}`, lo: c - 3, hi: c },
    { key: `${c + 1}_${c + 4}`, lo: c + 1, hi: c + 4 },
    { key: `ge_${c + 5}`, lo: c + 5, hi: null },
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
 * (fixed at generation, like O/U lines), so exactly one band wins. Bands are
 * centred on the player's MODEL PROJECTION (the preliminary sim's mean gross/
 * net, `ctx.projections`), so the four-way split stays balanced around where
 * the player actually scores — the whole point of the differential-first level
 * model is that form ≠ handicap. Handicap-implied score is a defensive fallback
 * if a projection is missing. Edges can shift slightly between refreshes as
 * form updates (the same property O/U lines already have).
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
    return ctx.players.filter((p) => !p.provisional).flatMap((p) => {
      const specs: MarketSpec[] = [];
      const proj = ctx.projections[p.profileId];
      for (const basis of ["gross", "net"] as const) {
        const projected = proj ? (basis === "gross" ? proj.meanGross : proj.meanNet) : null;
        const mean = projected ?? handicapImpliedScore(ctx, p.playingHandicap, basis);
        if (mean == null) continue;
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
    // Exact (noise-free) pricing from the calibrated per-hole model when holes
    // remain; otherwise the player's totals are deterministic and the retained
    // MC samples give the exact answer anyway.
    const analytic = sim.players[idx].analytic;
    if (analytic) {
      const pmf = basis === "gross" ? analyticDistributions(analytic).gross : analyticDistributions(analytic).net;
      for (const band of marketBands(market)) {
        out.set(band.key, pmfBandProbability(pmf, band.lo, band.hi));
      }
      return out;
    }
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

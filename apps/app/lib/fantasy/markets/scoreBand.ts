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
import { analyticDistributions, pmfBandProbability } from "@/lib/fantasy/markets/analytic";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

export type Band = { key: string; lo: number | null; hi: number | null };

function marketBasis(market: FantasyMarket): "gross" | "net" {
  return (market.params as { basis?: unknown }).basis === "net" ? "net" : "gross";
}

/**
 * Two 4-stroke inner bands with open tails, centred on `mean`. The junction
 * between the two inner bands sits at ≈ `mean`, so a distribution centred on the
 * projection splits evenly across them.
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

/**
 * Parse a self-describing band key back to its bounds — `le_<hi>` / `<lo>_<hi>` /
 * `ge_<lo>`. The key alone fully describes the band, so a placed pick can be
 * settled/priced without the market's currently-offered `params` (which drift).
 */
export function parseBandKey(key: string): Band | null {
  let m = /^le_(-?\d+)$/.exec(key);
  if (m) return { key, lo: null, hi: Number(m[1]) };
  m = /^ge_(-?\d+)$/.exec(key);
  if (m) return { key, lo: Number(m[1]), hi: null };
  m = /^(-?\d+)_(-?\d+)$/.exec(key);
  if (m) return { key, lo: Number(m[1]), hi: Number(m[2]) };
  return null;
}

function inBand(score: number, band: Band): boolean {
  if (band.lo != null && score < band.lo) return false;
  if (band.hi != null && score > band.hi) return false;
  return true;
}

/** The bands currently offered for a player = bandsAround(their projection). */
function currentBands(sim: SimulationResult, idx: number, basis: "gross" | "net"): Band[] {
  const mean = basis === "gross" ? sim.players[idx].meanGross : sim.players[idx].meanNet;
  return bandsAround(mean);
}

/**
 * Score bands — one market per (player, basis). The market IDENTITY is stable
 * (`params` = just the basis); the OFFERED bands are recomputed each refresh
 * from the player's model projection (the sim's mean gross/net) and priced by
 * summing the exact per-score distribution over each band's range
 * (`pmfBandProbability`). So the offered bands drift with form while the market
 * row never duplicates, and a placed pick settles/cashes on the exact band it
 * backed via its self-describing key (see `settleKey` / cashout).
 */
export const scoreBand: MarketDefinition = {
  type: "score_band",
  group: "scoring",
  eligibleForCashout: true,

  displayName(market, names) {
    return `${playerName(names, market.subject_profile_id)} ${marketBasis(market)} score band`;
  },

  selectionLabel(_market, selectionKey) {
    const band = parseBandKey(selectionKey);
    return band ? bandLabel(band) : selectionKey;
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    // Stable identity only — no band edges in params (they drift each refresh
    // and would spawn duplicate markets). Bands are computed in `simulate`.
    return ctx.players.filter((p) => !p.provisional).flatMap((p) =>
      (["gross", "net"] as const).map((basis) => ({
        market_type: "score_band" as const,
        subject_profile_id: p.profileId,
        params: { basis },
      }))
    );
  },

  selections(): string[] {
    // Dynamic — the offered bands come from the current snapshots, not params.
    return [];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const basis = marketBasis(market);
    const bands = currentBands(sim, idx, basis);
    // Exact (noise-free) pricing from the calibrated per-hole pmf when holes
    // remain; otherwise the totals are deterministic and the retained MC samples
    // give the exact answer anyway.
    const analytic = sim.players[idx].analytic;
    if (analytic) {
      const pmf = basis === "gross" ? analyticDistributions(analytic).gross : analyticDistributions(analytic).net;
      for (const band of bands) out.set(band.key, pmfBandProbability(pmf, band.lo, band.hi));
      return out;
    }
    const totals = basis === "gross" ? sim.players[idx].grossTotals : sim.players[idx].netTotals;
    for (const band of bands) {
      let hits = 0;
      for (let i = 0; i < totals.length; i++) {
        if (inBand(totals[i], band)) hits += 1;
      }
      out.set(band.key, hits / sim.simulationCount);
    }
    return out;
  },

  settle(): Map<string, SettlementOutcome> {
    // Bands are dynamic/self-describing → settlement resolves each pick via
    // `settleKey`; the batch map is intentionally empty.
    return new Map();
  },

  settleKey(final: FinalScoringData, market, selectionKey): SettlementOutcome {
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const basis = marketBasis(market);
    const score = basis === "gross" ? player?.grossScore : player?.netScore;
    const band = parseBandKey(selectionKey);
    if (!player || player.withdrawn || score == null || !band) return "void";
    return inBand(score, band) ? "won" : "lost";
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

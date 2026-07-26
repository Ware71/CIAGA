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
import { analyticDistributions, pmfUnderExactOver } from "@/lib/fantasy/markets/analytic";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

const SPREAD = 4; // projection ± SPREAD score values offered

type Basis = "gross" | "net";

function marketBasis(market: FantasyMarket): Basis {
  return (market.params as { basis?: unknown }).basis === "net" ? "net" : "gross";
}

/** Parse a self-describing score-total key `u_<v>` / `e_<v>` / `o_<v>`. */
export function parseScoreTotalKey(
  selectionKey: string
): { side: "u" | "e" | "o"; value: number } | null {
  const m = /^(u|e|o)_(-?\d+)$/.exec(selectionKey);
  if (!m) return null;
  return { side: m[1] as "u" | "e" | "o", value: Number(m[2]) };
}

/** The score values currently offered = the projection ± SPREAD. */
function currentValues(sim: SimulationResult, idx: number, basis: Basis): number[] {
  const mean = basis === "gross" ? sim.players[idx].meanGross : sim.players[idx].meanNet;
  const c = Math.round(mean);
  return Array.from({ length: SPREAD * 2 + 1 }, (_, i) => c - SPREAD + i);
}

/**
 * Score totals — one market per (player, gross|net). Replaces the old
 * separate over/under line and exact-score markets: for each of the ~9 score
 * values, offers a three-way Under / Exactly / Over split instead of a single
 * fixed .5 line. Selection keys: u_{v} / e_{v} / o_{v}. Event-wide only (no
 * round variant). The market IDENTITY is stable (`params` = just the basis);
 * the OFFERED values are recomputed each refresh, centred on the player's model
 * projection, and priced from the exact per-score distribution — so the offered
 * line drifts with form while the market row never duplicates, and a placed pick
 * settles/cashes on the exact value it backed via its self-describing key.
 */
export const scoreTotal: MarketDefinition = {
  type: "score_total",
  group: "scoring",
  eligibleForCashout: true,

  displayName(market, names) {
    return `${playerName(names, market.subject_profile_id)} ${marketBasis(market)} score`;
  },

  selectionLabel(_market, selectionKey) {
    const parsed = parseScoreTotalKey(selectionKey);
    if (!parsed) return selectionKey;
    if (parsed.side === "u") return `Under ${parsed.value}`;
    if (parsed.side === "o") return `Over ${parsed.value}`;
    return `Exactly ${parsed.value}`;
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    // Stable identity only — no score values in params (they drift each refresh
    // and would spawn duplicate markets). Values are computed in `simulate`.
    return ctx.players.filter((p) => !p.provisional).flatMap((p) =>
      (["gross", "net"] as const).map((basis) => ({
        market_type: "score_total" as const,
        subject_profile_id: p.profileId,
        params: { basis },
      }))
    );
  },

  selections(): string[] {
    // Dynamic — the offered values come from the current snapshots, not params.
    return [];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const basis = marketBasis(market);
    const values = currentValues(sim, idx, basis);
    // Exact under/exact/over from the calibrated per-hole model when holes
    // remain; deterministic (retained MC) fallback once fully played.
    const analytic = sim.players[idx].analytic;
    if (analytic) {
      const pmf = basis === "gross" ? analyticDistributions(analytic).gross : analyticDistributions(analytic).net;
      for (const v of values) {
        const { under, exact, over } = pmfUnderExactOver(pmf, v);
        out.set(`u_${v}`, under);
        out.set(`e_${v}`, exact);
        out.set(`o_${v}`, over);
      }
      return out;
    }
    const totals = basis === "gross" ? sim.players[idx].grossTotals : sim.players[idx].netTotals;
    for (const v of values) {
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

  settle(): Map<string, SettlementOutcome> {
    // Values are dynamic/self-describing → settlement resolves each pick via
    // `settleKey`; the batch map is intentionally empty.
    return new Map();
  },

  settleKey(final: FinalScoringData, market, selectionKey): SettlementOutcome {
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const basis = marketBasis(market);
    const score = basis === "gross" ? player?.grossScore : player?.netScore;
    const parsed = parseScoreTotalKey(selectionKey);
    if (!player || player.withdrawn || score == null || !parsed) return "void";
    if (parsed.side === "u") return score < parsed.value ? "won" : "lost";
    if (parsed.side === "o") return score > parsed.value ? "won" : "lost";
    return score === parsed.value ? "won" : "lost";
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

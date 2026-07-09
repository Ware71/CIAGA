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
import { holeKey } from "@/lib/fantasy/simulation/types";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

type HoleOutcome = "birdie_or_better" | "bogey_or_worse";

function marketOutcome(market: FantasyMarket): HoleOutcome {
  return (market.params as { outcome?: unknown }).outcome === "bogey_or_worse"
    ? "bogey_or_worse"
    : "birdie_or_better";
}

/** selection key "r{round}_h{hole}" ↔ (round, hole). */
export function holeSelectionKey(round: number, holeNumber: number): string {
  return `r${round}_h${holeNumber}`;
}

export function parseHoleSelection(key: string): { round: number; hole: number } | null {
  const m = /^r(\d+)_h(\d+)$/.exec(key);
  if (!m) return null;
  return { round: Number(m[1]), hole: Number(m[2]) };
}

/**
 * Hole-specific score markets — "Player X birdie or better on hole 11".
 * One market per player per outcome; every hole is a selection, priced from
 * the per-hole outcome bins (the hole_splits foundation). A hole that's been
 * played prices deterministically and can no longer be backed; settlement
 * reads the recorded hole scores at event end. No cash-out (near-instant
 * binary outcomes).
 */
export const holeScore: MarketDefinition = {
  type: "hole_score",
  group: "holes",
  eligibleForCashout: false,

  displayName(market, names) {
    const label =
      marketOutcome(market) === "birdie_or_better" ? "birdie or better" : "bogey or worse";
    return `${playerName(names, market.subject_profile_id)} — ${label} by hole`;
  },

  selectionLabel(_market, selectionKey) {
    const parsed = parseHoleSelection(selectionKey);
    if (!parsed) return selectionKey;
    return parsed.round > 1 ? `R${parsed.round} Hole ${parsed.hole}` : `Hole ${parsed.hole}`;
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    if (ctx.holes.length === 0) return [];
    return ctx.players.filter((p) => !p.provisional).flatMap((p) =>
      (["birdie_or_better", "bogey_or_worse"] as const).map((outcome) => ({
        market_type: "hole_score" as const,
        subject_profile_id: p.profileId,
        params: { outcome },
      }))
    );
  },

  selections(): string[] {
    // Selections are the event's holes; enumerated from the sim result.
    return [];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const idx = market.subject_profile_id ? sim.playerIndex[market.subject_profile_id] : undefined;
    if (idx === undefined) return out;
    const outcome = marketOutcome(market);
    sim.holes.forEach((hole, hi) => {
      const bins = sim.players[idx].holeOutcomes[hi];
      const p =
        outcome === "birdie_or_better"
          ? (bins[0] + bins[1]) / sim.simulationCount
          : // bogey or worse = par+1 and up (k ≥ OUTCOME_OFFSET+1), range-agnostic.
            bins.slice(3).reduce((s, b) => s + b, 0) / sim.simulationCount;
      out.set(holeSelectionKey(hole.round ?? 1, hole.holeNumber), p);
    });
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const player = market.subject_profile_id ? final.players[market.subject_profile_id] : undefined;
    const outcome = marketOutcome(market);
    for (const hole of final.holes) {
      const round = hole.round;
      const key = holeSelectionKey(round, hole.holeNumber);
      const strokes = player?.holeStrokes?.[holeKey(round, hole.holeNumber)];
      if (strokes == null) {
        // Hole never recorded (skipped, withdrawal, no hole data) → void.
        out.set(key, "void");
      } else if (outcome === "birdie_or_better") {
        out.set(key, strokes <= hole.par - 1 ? "won" : "lost");
      } else {
        out.set(key, strokes >= hole.par + 1 ? "won" : "lost");
      }
    }
    return out;
  },

  placementAllowed(market, selectionKey, ctx: LiveMarketCtx): boolean {
    if (ctx.eventCompleted) return false;
    const subject = market.subject_profile_id;
    const parsed = parseHoleSelection(selectionKey);
    if (!subject || !parsed) return false;
    if (ctx.roundComplete(subject, parsed.round)) return false;
    // Once the hole is recorded the outcome is known.
    return ctx.holeScore(subject, parsed.round, parsed.hole) == null;
  },

  isSelfDependent(market, _selectionKey, bettorProfileId): boolean {
    // Betting your own hole outcome is always self-resolvable (moot — the
    // market type is not cash-out eligible).
    return market.subject_profile_id === bettorProfileId;
  },

  cashoutCutoff() {
    return { eligible: false as const, reason: "Hole markets settle too quickly to cash out" };
  },
};

import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import type { RankingBasis, SimulationResult } from "@/lib/fantasy/simulation/types";

/**
 * Shared helpers for round-scoped market variants. A market with
 * params.round prices/settles against that event round only; without it,
 * against the whole event.
 */

export function marketRound(market: FantasyMarket): number | null {
  const r = Number((market.params as { round?: unknown }).round);
  return Number.isInteger(r) && r > 0 ? r : null;
}

/** "Round 2 " prefix for display names; empty for event-wide markets. */
export function roundPrefix(market: FantasyMarket): string {
  const r = marketRound(market);
  return r != null ? `Round ${r} ` : "";
}

/** The right joint-sample array for a market's scope and basis. */
export function totalsFor(
  sim: SimulationResult,
  playerIdx: number,
  // Round winners price on gross/net stroke totals; stableford collapses to net
  // (there's no per-round stableford total array, and round winners are rare).
  basis: RankingBasis,
  round: number | null
): Int16Array {
  const p = sim.players[playerIdx];
  if (round != null) {
    const totals = basis === "gross" ? p.roundGrossTotals[round] : p.roundNetTotals[round];
    if (totals) return totals;
  }
  return basis === "gross" ? p.grossTotals : p.netTotals;
}

/**
 * Per-iteration "who wins" probabilities on arbitrary totals arrays (used by
 * round-scoped winner/H2H where the engine's event-wide winProb doesn't
 * apply). Ties split evenly, mirroring the engine.
 */
export function winProbsFrom(totalsByPlayer: Int16Array[], simulationCount: number): number[] {
  const n = totalsByPlayer.length;
  const wins = new Array<number>(n).fill(0);
  for (let iter = 0; iter < simulationCount; iter++) {
    let best = Infinity;
    for (let pi = 0; pi < n; pi++) {
      const v = totalsByPlayer[pi][iter];
      if (v < best) best = v;
    }
    let tied = 0;
    for (let pi = 0; pi < n; pi++) if (totalsByPlayer[pi][iter] === best) tied += 1;
    for (let pi = 0; pi < n; pi++) {
      if (totalsByPlayer[pi][iter] === best) wins[pi] += 1 / tied;
    }
  }
  return wins.map((w) => w / simulationCount);
}

/**
 * Exact count distribution from independent per-hole probabilities
 * (the model samples holes independently, so this matches the engine's
 * joint sampling): dist[k] = P(exactly k successes over the given holes).
 */
export function countDistribution(perHoleProb: number[]): number[] {
  let dist = [1];
  for (const p of perHoleProb) {
    const next = new Array<number>(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

/** Hole indices (into sim.holes / holeOutcomes) belonging to a round. */
export function holeIdxsForRound(sim: SimulationResult, round: number | null): number[] {
  const out: number[] = [];
  sim.holes.forEach((h, i) => {
    if (round == null || (h.round ?? 1) === round) out.push(i);
  });
  return out;
}

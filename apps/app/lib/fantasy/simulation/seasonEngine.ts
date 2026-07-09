// Fantasy Picks — season-long Monte Carlo.
//
// Prices season markets (winner / top-3 in the standings) by simulating the
// REMAINING events and rolling their projected points onto the current
// standings. Each remaining event reuses its per-event joint positions matrix
// (from Change 3), so a season-iteration draws one aligned iteration per event,
// reads each player's finishing position, maps it to season points, and ranks
// the final standings. Pure (rng only) → unit-testable.

import { mulberry32 } from "@/lib/fantasy/simulation/rng";
import type { JointMatrix } from "@/lib/fantasy/simulation/jointPricing";
import { eventPointsForPosition, type EventPointsConfig } from "@/lib/fantasy/simulation/seasonPoints";

export type RemainingEvent = { matrix: JointMatrix; points: EventPointsConfig };

export type SeasonSimInputs = {
  /** Current season points per profile (from group_season_standings_entries). */
  currentPoints: Record<string, number>;
  /** Every profile that could feature (standings ∪ remaining fields). */
  playerIds: string[];
  remaining: RemainingEvent[];
  iterations: number;
  seed: number;
};

export type SeasonSimResult = {
  players: { profileId: string; winProb: number; top3Prob: number }[];
  iterations: number;
};

export function simulateSeason(inputs: SeasonSimInputs): SeasonSimResult {
  const { currentPoints, playerIds, remaining, iterations, seed } = inputs;
  const rand = mulberry32(seed);
  const n = playerIds.length;
  const idx = new Map(playerIds.map((id, i) => [id, i]));
  const base = playerIds.map((id) => currentPoints[id] ?? 0);
  const winCount = new Array<number>(n).fill(0);
  const top3Count = new Array<number>(n).fill(0);
  const totals = new Float64Array(n);
  const iters = Math.max(1, iterations);

  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) totals[i] = base[i];

    for (const ev of remaining) {
      const s = Math.floor(rand() * ev.matrix.simCount);
      for (let c = 0; c < ev.matrix.playerIds.length; c++) {
        const pi = idx.get(ev.matrix.playerIds[c]);
        if (pi === undefined) continue;
        const pos = ev.matrix.positions[c * ev.matrix.simCount + s];
        if (pos > 0) totals[pi] += eventPointsForPosition(ev.points, pos);
      }
    }

    // Rank: winner ties split evenly; top-3 counts every player at rank ≤ 3.
    let best = -Infinity;
    for (let i = 0; i < n; i++) if (totals[i] > best) best = totals[i];
    let tiedForBest = 0;
    for (let i = 0; i < n; i++) if (totals[i] === best) tiedForBest += 1;
    for (let i = 0; i < n; i++) {
      if (totals[i] === best) winCount[i] += 1 / tiedForBest;
      let strictlyBetter = 0;
      for (let j = 0; j < n; j++) if (totals[j] > totals[i]) strictlyBetter += 1;
      if (strictlyBetter + 1 <= 3) top3Count[i] += 1;
    }
  }

  return {
    players: playerIds.map((id, i) => ({
      profileId: id,
      winProb: winCount[i] / iters,
      top3Prob: top3Count[i] / iters,
    })),
    iterations: iters,
  };
}

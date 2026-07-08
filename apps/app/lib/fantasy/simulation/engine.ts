import { mulberry32 } from "@/lib/fantasy/simulation/rng";
import {
  buildHoleDistributions,
  toCumulative,
  sampleOutcome,
  OUTCOME_OFFSET,
  OUTCOME_BINS,
} from "@/lib/fantasy/simulation/holeModel";
import type {
  SimulationInputs,
  SimulationResult,
  SimPlayerResult,
} from "@/lib/fantasy/simulation/types";

export const SIMULATION_COUNT = 10_000;
/** Fields larger than this degrade to a lighter run instead of batching. */
export const REDUCED_SIMULATION_COUNT = 5_000;
export const REDUCED_SIMULATION_FIELD_SIZE = 60;

export const TOP_N_TARGETS = [3, 5, 10] as const;

/** A hole score counts as a birdie when it's birdie **or better** (≤ par−1). */
function isBirdieOutcome(k: number): boolean {
  return k <= 1; // k=0 eagle-or-better, k=1 birdie
}

export function pickSimulationCount(fieldSize: number): number {
  return fieldSize > REDUCED_SIMULATION_FIELD_SIZE ? REDUCED_SIMULATION_COUNT : SIMULATION_COUNT;
}

/**
 * Monte Carlo over the event: samples per-hole outcomes for every incomplete
 * hole of every player, fixes already-played holes, and derives joint gross /
 * net totals, rankings, and birdie counts. One run prices every market.
 *
 * Net total = gross − playing handicap (stroke-index allocation nets out over
 * a full round); per-hole outcomes are retained as the foundation for future
 * hole-specific markets.
 */
export function runSimulation(inputs: SimulationInputs): SimulationResult {
  const { players, holes, rankingBasis, seed } = inputs;
  const simulationCount = Math.max(1, inputs.simulationCount);
  const rand = mulberry32(seed);
  const playerCount = players.length;

  const results: SimPlayerResult[] = players.map((p) => ({
    profileId: p.profileId,
    grossTotals: new Int16Array(simulationCount),
    netTotals: new Int16Array(simulationCount),
    birdieHistogram: new Array<number>(holes.length + 1).fill(0),
    winProb: 0,
    topNProb: {},
    meanGross: 0,
    meanNet: 0,
    holeOutcomes: holes.map(() => new Array<number>(OUTCOME_BINS).fill(0)),
  }));

  // Per-player precomputation: fixed strokes/birdies from completed holes and
  // cumulative sampling tables for the holes still to play.
  const prepared = players.map((player, pi) => {
    const remainingIdx: number[] = [];
    let fixedGross = 0;
    let fixedBirdies = 0;
    holes.forEach((hole, hi) => {
      const played = player.completedHoles[hole.holeNumber];
      if (played != null) {
        fixedGross += played;
        const k = Math.min(
          OUTCOME_BINS - 1,
          Math.max(0, played - hole.par + OUTCOME_OFFSET)
        );
        if (isBirdieOutcome(k)) fixedBirdies += 1;
        // Real outcome fills the hole histogram deterministically.
        results[pi].holeOutcomes[hi][k] = simulationCount;
      } else if (!player.roundComplete) {
        remainingIdx.push(hi);
      }
    });
    const dists = buildHoleDistributions(
      player.profile,
      remainingIdx.map((hi) => holes[hi])
    );
    return {
      remainingIdx,
      fixedGross,
      fixedBirdies,
      cumulative: toCumulative(dists),
      pars: remainingIdx.map((hi) => holes[hi].par),
    };
  });

  const basisTotals = new Int16Array(playerCount);

  for (let iter = 0; iter < simulationCount; iter++) {
    for (let pi = 0; pi < playerCount; pi++) {
      const prep = prepared[pi];
      const res = results[pi];
      let gross = prep.fixedGross;
      let birdies = prep.fixedBirdies;

      for (let r = 0; r < prep.remainingIdx.length; r++) {
        const k = sampleOutcome(prep.cumulative[r], rand());
        gross += prep.pars[r] + k - OUTCOME_OFFSET;
        if (isBirdieOutcome(k)) birdies += 1;
        res.holeOutcomes[prep.remainingIdx[r]][k] += 1;
      }

      const net = gross - players[pi].playingHandicap;
      res.grossTotals[iter] = gross;
      res.netTotals[iter] = net;
      res.birdieHistogram[Math.min(birdies, holes.length)] += 1;
      basisTotals[pi] = rankingBasis === "gross" ? gross : net;
    }

    // Standard competition ranking ("1224"): position = 1 + strictly better.
    // Winner ties split the win evenly; top-N ties all count as in.
    let best = Infinity;
    for (let pi = 0; pi < playerCount; pi++) {
      if (basisTotals[pi] < best) best = basisTotals[pi];
    }
    let tiedForBest = 0;
    for (let pi = 0; pi < playerCount; pi++) {
      if (basisTotals[pi] === best) tiedForBest += 1;
    }
    for (let pi = 0; pi < playerCount; pi++) {
      const mine = basisTotals[pi];
      if (mine === best) results[pi].winProb += 1 / tiedForBest;
      let strictlyBetter = 0;
      for (let pj = 0; pj < playerCount; pj++) {
        if (basisTotals[pj] < mine) strictlyBetter += 1;
      }
      const position = 1 + strictlyBetter;
      for (const n of TOP_N_TARGETS) {
        if (position <= n) {
          results[pi].topNProb[n] = (results[pi].topNProb[n] ?? 0) + 1;
        }
      }
    }
  }

  for (let pi = 0; pi < playerCount; pi++) {
    const res = results[pi];
    res.winProb /= simulationCount;
    for (const n of TOP_N_TARGETS) {
      res.topNProb[n] = (res.topNProb[n] ?? 0) / simulationCount;
    }
    let grossSum = 0;
    let netSum = 0;
    for (let iter = 0; iter < simulationCount; iter++) {
      grossSum += res.grossTotals[iter];
      netSum += res.netTotals[iter];
    }
    res.meanGross = grossSum / simulationCount;
    res.meanNet = netSum / simulationCount;
  }

  const playerIndex: Record<string, number> = {};
  players.forEach((p, pi) => {
    playerIndex[p.profileId] = pi;
  });

  return { simulationCount, rankingBasis, players: results, playerIndex };
}

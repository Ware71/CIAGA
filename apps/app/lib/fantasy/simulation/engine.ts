import { mulberry32, nextNormal, normalCdf } from "@/lib/fantasy/simulation/rng";
import {
  buildHoleDistributions,
  toCumulative,
  sampleOutcome,
  strokesReceived,
  INTRA_ROUND_CORRELATION,
  OUTCOME_OFFSET,
  OUTCOME_BINS,
} from "@/lib/fantasy/simulation/holeModel";
import {
  holeKey,
  type SimulationInputs,
  type SimulationResult,
  type SimPlayerResult,
} from "@/lib/fantasy/simulation/types";

export const SIMULATION_COUNT = 20_000;
/** Fields larger than this degrade to a lighter run instead of batching. */
export const REDUCED_SIMULATION_COUNT = 10_000;
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
 * net totals (event-wide AND per round), rankings, position histograms and
 * birdie counts. One run prices every market.
 *
 * Multi-round events pass holes tagged with their round; completed-hole maps
 * are keyed by holeKey(round, hole). Net total = gross − PH × rounds (the
 * leaderboard applies the playing handicap once per submitted round).
 */
export function runSimulation(inputs: SimulationInputs): SimulationResult {
  const { players, holes, rankingBasis, seed } = inputs;
  const simulationCount = Math.max(1, inputs.simulationCount);
  const rand = mulberry32(seed);
  const playerCount = players.length;

  // Rounds present in the hole set (single-round events → [1]).
  const roundNumbers = [...new Set(holes.map((h) => h.round ?? 1))].sort((a, b) => a - b);
  const roundIdxByNumber = new Map(roundNumbers.map((r, i) => [r, i]));
  const roundOfHole = holes.map((h) => roundIdxByNumber.get(h.round ?? 1)!);

  // Stableford events rank on POINTS (per hole max(0, 2 − netStrokesOverPar)),
  // which caps blow-up holes at 0 — so volatile players do relatively better
  // than under net stroke. holesPerRound drives per-hole stroke allocation.
  const isStableford = rankingBasis === "stableford";
  const holesPerRound = roundNumbers.map((rn) =>
    holes.reduce((n, h) => n + ((h.round ?? 1) === rn ? 1 : 0), 0)
  );

  const results: SimPlayerResult[] = players.map((p) => ({
    profileId: p.profileId,
    grossTotals: new Int16Array(simulationCount),
    netTotals: new Int16Array(simulationCount),
    roundGrossTotals: Object.fromEntries(
      roundNumbers.map((r) => [r, new Int16Array(simulationCount)])
    ),
    roundNetTotals: Object.fromEntries(
      roundNumbers.map((r) => [r, new Int16Array(simulationCount)])
    ),
    birdieHistogram: new Array<number>(holes.length + 1).fill(0),
    birdieCounts: new Int8Array(simulationCount),
    eagleCounts: new Int8Array(simulationCount),
    roundBirdieCounts: Object.fromEntries(
      roundNumbers.map((r) => [r, new Int8Array(simulationCount)])
    ),
    winProb: 0,
    topNProb: {},
    positionHistogram: new Array<number>(playerCount).fill(0),
    lastProb: 0,
    meanGross: 0,
    meanNet: 0,
    holeOutcomes: holes.map(() => new Array<number>(OUTCOME_BINS).fill(0)),
  }));

  // Per-player precomputation: fixed strokes/birdies from completed holes and
  // cumulative sampling tables for the holes still to play.
  const prepared = players.map((player, pi) => {
    const completedRoundSet = new Set(
      player.completedRounds ?? (player.roundComplete ? roundNumbers : [])
    );
    const remainingIdx: number[] = [];
    const fixedRoundGross = new Array<number>(roundNumbers.length).fill(0);
    const fixedRoundBirdies = new Array<number>(roundNumbers.length).fill(0);
    let fixedBirdies = 0;
    let fixedEagles = 0;
    let fixedStableford = 0;
    holes.forEach((hole, hi) => {
      const round = hole.round ?? 1;
      const played = player.completedHoles[holeKey(round, hole.holeNumber)];
      if (played != null) {
        fixedRoundGross[roundOfHole[hi]] += played;
        const k = Math.min(
          OUTCOME_BINS - 1,
          Math.max(0, played - hole.par + OUTCOME_OFFSET)
        );
        if (isBirdieOutcome(k)) {
          fixedBirdies += 1;
          fixedRoundBirdies[roundOfHole[hi]] += 1;
        }
        if (k === 0) fixedEagles += 1;
        if (isStableford) {
          const sr = strokesReceived(player.playingHandicap, hole.strokeIndex, holesPerRound[roundOfHole[hi]]);
          fixedStableford += Math.max(0, 2 - (played - hole.par - sr));
        }
        // Real outcome fills the hole histogram deterministically.
        results[pi].holeOutcomes[hi][k] = simulationCount;
      } else if (!player.roundComplete && !completedRoundSet.has(round)) {
        remainingIdx.push(hi);
      }
    });
    const dists = buildHoleDistributions(
      player.profile,
      remainingIdx.map((hi) => holes[hi]),
      player.playingHandicap
    );
    // Expose the calibrated per-hole model for exact single-player pricing
    // (only when holes remain — a fully-played player's totals are fixed).
    if (remainingIdx.length > 0) {
      results[pi].analytic = {
        holeDists: dists,
        holePars: remainingIdx.map((hi) => holes[hi].par),
        holeRounds: remainingIdx.map((hi) => roundOfHole[hi]),
        fixedGross: fixedRoundGross.reduce((s, x) => s + x, 0),
        fixedBirdies,
        fixedEagles,
        roundCount: roundNumbers.length,
        playingHandicap: player.playingHandicap,
      };
    }
    return {
      remainingIdx,
      fixedRoundGross,
      fixedRoundBirdies,
      fixedBirdies,
      fixedEagles,
      fixedStableford,
      cumulative: toCumulative(dists),
      pars: remainingIdx.map((hi) => holes[hi].par),
      rounds: remainingIdx.map((hi) => roundOfHole[hi]),
      // Handicap strokes each remaining hole receives (stableford only).
      srPerHole: isStableford
        ? remainingIdx.map((hi) =>
            strokesReceived(player.playingHandicap, holes[hi].strokeIndex, holesPerRound[roundOfHole[hi]])
          )
        : [],
    };
  });

  const basisTotals = new Int16Array(playerCount);
  const roundGrossScratch = new Array<number>(roundNumbers.length).fill(0);
  const roundBirdieScratch = new Array<number>(roundNumbers.length).fill(0);
  // One-factor Gaussian copula: a shared per-(player, round) "day" normal makes
  // a round's holes positively correlated (ρ) without moving any hole's
  // marginal pmf — so birdie/eagle counts get realistic over-dispersion while
  // the level and rare-event calibration stay exact. Per-hole σ is pre-shrunk
  // (holeSigmaDetailed) so the correlated round total keeps variance σ_round².
  const SQRT_RHO = Math.sqrt(INTRA_ROUND_CORRELATION);
  const SQRT_1MRHO = Math.sqrt(1 - INTRA_ROUND_CORRELATION);
  const dayNormal = new Array<number>(roundNumbers.length).fill(0);
  // Antithetic variates: draw normals fresh on even iterations into a buffer,
  // then reuse them NEGATED on the paired odd iteration (a negated normal maps
  // to 1−u under the copula → the mirror-image round). Roughly halves the MC
  // variance of the multi-player markets (winner / positions / h2h) and the
  // fixed-seed noise the odds ladder otherwise locks in. The draw order is
  // identical across the pair (fields don't change mid-run), so the buffer
  // cursor stays aligned. Single-player markets are priced analytically and
  // don't rely on this.
  const normalsPerIter = prepared.reduce(
    (s, prep) => s + roundNumbers.length + prep.remainingIdx.length,
    0
  );
  const normalBuf = new Float64Array(Math.max(1, normalsPerIter));
  let antithetic = false;
  let nCursor = 0;
  const drawNormal = (): number => {
    if (antithetic) return -normalBuf[nCursor++];
    const g = nextNormal(rand);
    normalBuf[nCursor++] = g;
    return g;
  };
  // Per-iteration finishing positions (1-based; 0 = absent), retained for
  // correlated-acca joint pricing. [pi * simulationCount + iter].
  const positions = new Int8Array(playerCount * simulationCount);
  // Attendance: provisional (not-yet-entered) members are present only a
  // fraction of iterations. Confirmed players never draw, so the RNG stream is
  // unchanged for fully-confirmed fields (existing behaviour holds).
  const attendanceProbs = players.map((p) => p.attendanceProb ?? 1);
  const provisional = attendanceProbs.map((a) => a < 1);
  const present = new Uint8Array(playerCount);

  for (let iter = 0; iter < simulationCount; iter++) {
    antithetic = (iter & 1) === 1;
    nCursor = 0;
    for (let pi = 0; pi < playerCount; pi++) {
      const prep = prepared[pi];
      const res = results[pi];
      for (let r = 0; r < roundNumbers.length; r++) {
        roundGrossScratch[r] = prep.fixedRoundGross[r];
        roundBirdieScratch[r] = prep.fixedRoundBirdies[r];
      }
      let birdies = prep.fixedBirdies;
      let eagles = prep.fixedEagles;
      let stableford = prep.fixedStableford;

      // Shared "day" normal per round (correlates this player's holes within it).
      for (let r = 0; r < roundNumbers.length; r++) dayNormal[r] = drawNormal();

      for (let r = 0; r < prep.remainingIdx.length; r++) {
        // Copula uniform: z = √ρ·day + √(1−ρ)·holeNoise → Φ(z) preserves the
        // hole's marginal while sharing the round's day factor.
        const z = SQRT_RHO * dayNormal[prep.rounds[r]] + SQRT_1MRHO * drawNormal();
        const k = sampleOutcome(prep.cumulative[r], normalCdf(z));
        roundGrossScratch[prep.rounds[r]] += prep.pars[r] + k - OUTCOME_OFFSET;
        if (isBirdieOutcome(k)) {
          birdies += 1;
          roundBirdieScratch[prep.rounds[r]] += 1;
        }
        if (k === 0) eagles += 1;
        res.holeOutcomes[prep.remainingIdx[r]][k] += 1;
        if (isStableford) {
          stableford += Math.max(0, 2 - (k - OUTCOME_OFFSET - prep.srPerHole[r]));
        }
      }

      const ph = players[pi].playingHandicap;
      let gross = 0;
      for (let r = 0; r < roundNumbers.length; r++) {
        const rg = roundGrossScratch[r];
        gross += rg;
        res.roundGrossTotals[roundNumbers[r]][iter] = rg;
        res.roundNetTotals[roundNumbers[r]][iter] = rg - ph;
      }
      const net = gross - ph * roundNumbers.length;
      res.grossTotals[iter] = gross;
      res.netTotals[iter] = net;
      res.birdieHistogram[Math.min(birdies, holes.length)] += 1;
      res.birdieCounts[iter] = birdies;
      res.eagleCounts[iter] = eagles;
      for (let r = 0; r < roundNumbers.length; r++) {
        res.roundBirdieCounts[roundNumbers[r]][iter] = roundBirdieScratch[r];
      }
      // Stableford ranks on POINTS (higher = better) → negate so the min-based
      // ranking below still selects the winner.
      basisTotals[pi] = isStableford ? -stableford : rankingBasis === "gross" ? gross : net;
    }

    // Sample attendance (confirmed players always present; provisional players
    // present with probability attendanceProb) — only present players rank.
    for (let pi = 0; pi < playerCount; pi++) {
      present[pi] = provisional[pi] ? (rand() < attendanceProbs[pi] ? 1 : 0) : 1;
    }

    // Standard competition ranking ("1224"): position = 1 + strictly better,
    // over the PRESENT players. Winner/last ties split evenly; top-N ties all in.
    let best = Infinity;
    let worst = -Infinity;
    let presentCount = 0;
    for (let pi = 0; pi < playerCount; pi++) {
      if (!present[pi]) continue;
      presentCount += 1;
      if (basisTotals[pi] < best) best = basisTotals[pi];
      if (basisTotals[pi] > worst) worst = basisTotals[pi];
    }
    if (presentCount === 0) continue; // degenerate: nobody turned up this iteration
    let tiedForBest = 0;
    let tiedForWorst = 0;
    for (let pi = 0; pi < playerCount; pi++) {
      if (!present[pi]) continue;
      if (basisTotals[pi] === best) tiedForBest += 1;
      if (basisTotals[pi] === worst) tiedForWorst += 1;
    }
    for (let pi = 0; pi < playerCount; pi++) {
      if (!present[pi]) continue;
      const mine = basisTotals[pi];
      // winProb SPLITS a tie: the outright is decided by a playoff/countback, so
      // exactly one of the tied players takes it. lastProb does NOT split —
      // finishRange settles the wooden spoon on `position === worst`, which pays
      // every tied player, so splitting here priced it systematically too long.
      if (mine === best) results[pi].winProb += 1 / tiedForBest;
      if (mine === worst) results[pi].lastProb += 1;
      let strictlyBetter = 0;
      for (let pj = 0; pj < playerCount; pj++) {
        if (present[pj] && basisTotals[pj] < mine) strictlyBetter += 1;
      }
      const position = 1 + strictlyBetter;
      results[pi].positionHistogram[position - 1] += 1;
      positions[pi * simulationCount + iter] = position;
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
    res.lastProb /= simulationCount;
    for (const n of TOP_N_TARGETS) {
      res.topNProb[n] = (res.topNProb[n] ?? 0) / simulationCount;
    }
    for (let i = 0; i < res.positionHistogram.length; i++) {
      res.positionHistogram[i] /= simulationCount;
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

  return { simulationCount, rankingBasis, players: results, playerIndex, holes, positions };
}

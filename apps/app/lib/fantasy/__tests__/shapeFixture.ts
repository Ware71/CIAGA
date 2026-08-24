import { parPriorMean, POPULATION_GAP } from "@/lib/fantasy/simulation/holeModel";

/**
 * A self-consistent birdie/par/bogey/double+ shape for a player who averages
 * `avgGross` on a par-72 course.
 *
 * Fixtures used to pin `parsPerRound: 7` on every player while varying
 * `avgGross` from 73 to 108. Those describe golfers who cannot exist — the four
 * rates have to partition all 18 holes AND reconcile with the level:
 *
 *     pars + bogeys + doubles+          = 18 − birdies
 *     −birdies + bogeys + T·(doubles+)  = avgGross − 72
 *
 * It didn't matter while only the birdie bin was calibrated. Now that the par
 * bin is calibrated too, an impossible shape forces the model to choose between
 * the stated shape and the stated level, and the mean-preservation loop loses
 * (a 108-shooter claiming 7 pars/round needs a 32× par upscale and drifts ~8
 * strokes off its own μ).
 *
 * Pars come from the same fitted prior the model uses, clamped to the window
 * where the two equations have a non-negative solution; bogeys and double-plus
 * then follow exactly.
 */

/** Mean strokes over par of a double-plus hole — the model's own tail centre. */
const TAIL_MEAN = 2.6;

export type ShapeRates = {
  parsPerRound: number;
  bogeysPerRound: number;
  doublesPlusPerRound: number;
};

export function shapeFor(avgGross: number, birdiesPerRound = 1, holes = 18): ShapeRates {
  const overPar = avgGross - 72;
  const b = birdiesPerRound;
  // Feasible par window: d >= 0 needs p >= holes − overPar − 2b; d <= rest needs
  // p <= holes − b − (overPar + b)/TAIL_MEAN.
  const loPar = Math.max(0, holes - overPar - 2 * b);
  const hiPar = Math.max(loPar, holes - b - (overPar + b) / TAIL_MEAN);
  const prior = parPriorMean(Math.max(0, overPar - POPULATION_GAP));
  const pars = Math.min(hiPar, Math.max(loPar, prior));

  const rest = Math.max(0, holes - b - pars);
  const doubles = Math.max(0, Math.min(rest, (overPar + b - rest) / (TAIL_MEAN - 1)));
  return {
    parsPerRound: round2(pars),
    bogeysPerRound: round2(rest - doubles),
    doublesPlusPerRound: round2(doubles),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

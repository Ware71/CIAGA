// lib/stats/projection/improvement.ts
//
// How a player's scoring ability changes as they play. This is the term that
// lets a projected handicap keep falling over years.
//
//     dL/dround = -a · max(0, L - floor)
//
// Improvement is proportional to HEADROOM, and to nothing else. A player two
// strokes off their ceiling improves slowly; one ten strokes off improves fast.
//
// ── What this replaced, and why ─────────────────────────────────────────────
//
// First attempt: extrapolate the player's own recent slope. The data says that
// barely works — regressing next-20-round slope on prior-20-round slope gives
// 0.132 (t = 3.5), a momentum half-life of about seven rounds. Real, but far too
// short to drive a multi-year forecast. It survives as a small separate term in
// ../simulate.ts.
//
// Second attempt added an experience factor, exp(-n / N0), on the theory that
// players with many rounds improve less. It was removed. Four checks
// (scripts/test-experience-term.mjs):
//
//   - rounds-played and level correlate at -0.668, so the factor was mostly
//     re-explaining the headroom the model already had;
//   - the headroom-only residuals correlate with rounds-played at just 0.067 —
//     there was no leftover signal for it to explain;
//   - WITHIN the player with the most history (232 observations), the
//     improvement rate per stroke of headroom got roughly three times FASTER
//     after 100+ rounds, the opposite of what the factor asserts. The only other
//     player with enough data went the other way, so there is no reliable effect;
//   - and `n` counts rounds recorded in CIAGA, not rounds played in a lifetime.
//     A twenty-year golfer joining the society starts at n = 0, indistinguishable
//     from a beginner. The variable was the wrong one even in principle.
//
// Its apparent 18.9% variance gain was an artefact of letting a second badly
// identified parameter absorb fitting error: headroom-only with a free floor
// lands on F = 15.5, which would mean nobody improves past a ~12 handicap.
//
// ── The floor is a PRIOR, not a measurement ─────────────────────────────────
//
// Bootstrapping the fit by player leaves the floor spanning [-2.6, 26.4]. The
// reason is structural: the best player in the data sits at level 10.9 and
// NOBODY has ever plateaued near scratch, so the fit places the floor just under
// the best level it has seen. Taken literally it would say no CIAGA player can
// ever beat about a 5 handicap — a fact about the dataset, not about golf.
//
// So the floor is drawn per simulated path from an explicit prior, wide enough
// to carry that ignorance into the fan. It is the single most consequential
// number behind any "when will I go scratch" answer, and it is a choice.
// Revisit it when somebody in the data has actually plateaued low.

import { normalCdf } from "@/lib/fantasy/simulation/rng";

/**
 * Improvement per round, per stroke of headroom.
 *
 * The best-identified parameter in the model: fitting each player separately
 * with the floor held at the prior centre gives 0.0072, 0.0098 and 0.0108 — a
 * spread of about 1.5x, against 10x or worse for everything else here.
 */
export const IMPROVEMENT_RATE = 0.009;

/**
 * Centre of the floor prior, in differential level. The fitted value; see the
 * header for why it is not evidence about anyone's ceiling.
 */
export const FLOOR_PRIOR_CENTRE = 8.1;

/**
 * Spread of the floor prior. Deliberately wide — the bootstrap spans roughly 30
 * strokes, and pretending to more precision would manufacture confidence about a
 * player's ceiling that the data cannot support.
 */
export const FLOOR_PRIOR_SD = 3.5;

/**
 * Hard lower bound on the prior. A differential level near 2.8 corresponds to a
 * scratch index (level minus roughly 0.93 sigma), so this admits meaningfully
 * below scratch — a genuinely talented player's paths must be able to get there —
 * without allowing physically absurd ceilings.
 */
export const FLOOR_PRIOR_MIN = -3;

/**
 * Expected change in scoring level for one more round. Negative is improvement.
 *
 * Returns 0 at or below the floor, so the curve approaches it rather than
 * crossing. Note there is deliberately no experience term: how many rounds a
 * player has posted does not, on this data, predict how much further they will
 * improve once headroom is accounted for.
 */
export function levelChangePerRound(
  level: number,
  floor: number,
  rate = IMPROVEMENT_RATE
): number {
  const headroom = level - floor;
  if (headroom <= 0) return 0;
  return -rate * headroom;
}

/**
 * Largest share of the gap to their target a player may close. Slightly above 1
 * so a genuinely talented player can finish better than the population target.
 */
export const CEILING_FRACTION_MAX = 1.15;

/**
 * Draw one path's floor — the level this player eventually settles at.
 *
 * TWO draws, because there are two separate unknowns:
 *
 *   target — where the population tends toward, ~N(8.1, 3.5)
 *   fraction — how much of THEIR OWN gap to it this player closes, ~U(0, 1.15)
 *
 *     floor = currentLevel - fraction x (currentLevel - target)
 *
 * The fraction is what makes the prior relative to the player rather than
 * absolute, and it is the fix for a real failure. A prior of plain N(8.1, 3.5)
 * put the ceiling in the same place for everyone: for a player at level 23.5 the
 * chance of drawing a floor at or above where they already stand was z = 4.4,
 * about five in a million. The model had effectively ruled out "you might
 * already be roughly as good as you are going to get", and duly reported a 100%
 * probability that a 20-handicap would reach 18. That is not a defensible thing
 * to be certain about.
 *
 * The uniform fraction is not arbitrary. The four careers with enough history
 * have closed 89%, 69%, 36% and 6% of their gap so far — mean 0.50, sd 0.36,
 * which is very close to uniform on [0, 1]. Two caveats worth keeping in mind:
 * those careers are still in progress, so the eventual fractions are higher than
 * the figures above; and players who accumulate 200+ rounds in a golf society
 * are the engaged ones, so the sample leans toward improvers.
 */
export function sampleFloor(
  currentLevel: number,
  targetDraw: number,
  fractionDraw: number,
  centre = FLOOR_PRIOR_CENTRE,
  sd = FLOOR_PRIOR_SD
): number {
  // Where this path thinks the population settles. Never above the player, so
  // the gap below is non-negative.
  const target = Math.min(currentLevel, Math.max(FLOOR_PRIOR_MIN, centre + targetDraw * sd));

  // How much of their own gap they close. `normalCdf` turns the antithetic
  // normal draw into a uniform while preserving the mirroring — negating the
  // normal maps u to 1 - u.
  const fraction = normalCdf(fractionDraw) * CEILING_FRACTION_MAX;

  return Math.max(FLOOR_PRIOR_MIN, currentLevel - fraction * (currentLevel - target));
}

/** Walk the level forward `rounds` rounds. Exposed for testing. */
export function projectLevel(level: number, rounds: number, floor: number): number {
  let L = level;
  for (let i = 0; i < rounds; i++) L += levelChangePerRound(L, floor);
  return L;
}

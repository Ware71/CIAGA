// lib/stats/projection/nextRound.ts
//
// What the very next round does to a Handicap Index.
//
// This is the one thing on the projections page that carries NO model risk. It
// is not a forecast: given the player's committed 20-round window, "if your next
// differential is X, your index becomes exactly Y" is a total function of state
// the database already holds, computed by the same WHS arithmetic the database
// uses. There is no distribution, no trend, no cadence assumption, nothing to be
// wrong about.
//
// It is also the only projection surface that works for a player with three
// accepted rounds — which, in a golf society, is most of them.

import {
  cloneWhsState,
  fromTenths,
  postInPlace,
  toTenths,
  WHS_MAX_INDEX_TENTHS,
  type WhsState,
} from "@/lib/whs/handicapIndex";

/** Lowest differential worth offering — better than a scratch player's best day. */
const MIN_DIFFERENTIAL_TENTHS = -100; // -10.0

export type NextRoundPoint = {
  /** The hypothetical differential for the next round. */
  differential: number;
  /** The resulting Handicap Index, or null if still below the 3-round minimum. */
  handicapIndex: number | null;
  /** Change from the current index. Null when either side is unknown. */
  delta: number | null;
};

/**
 * Post a single hypothetical differential and read off the resulting index.
 * Never mutates `state`.
 */
export function indexAfterDifferential(
  state: WhsState,
  dayIndex: number,
  differential: number
): number | null {
  const s = cloneWhsState(state);
  const tenths = postInPlace(s, dayIndex, toTenths(differential));
  return tenths === null ? null : fromTenths(tenths);
}

/**
 * A grid of "shoot this → get that", centred on the level the player is
 * currently scoring at.
 */
export function nextRoundImpact(
  state: WhsState,
  dayIndex: number,
  opts: { centre: number; spread?: number; stepTenths?: number; currentHi?: number | null }
): NextRoundPoint[] {
  const spread = opts.spread ?? 8;
  const step = Math.max(1, Math.round(opts.stepTenths ?? 5));
  const centreTenths = toTenths(opts.centre);
  const spreadTenths = toTenths(spread);

  const from = Math.max(MIN_DIFFERENTIAL_TENTHS, centreTenths - spreadTenths);
  const to = Math.min(WHS_MAX_INDEX_TENTHS, centreTenths + spreadTenths);

  const out: NextRoundPoint[] = [];
  for (let t = from; t <= to; t += step) {
    const differential = fromTenths(t);
    const handicapIndex = indexAfterDifferential(state, dayIndex, differential);
    const current = opts.currentHi;
    out.push({
      differential,
      handicapIndex,
      delta:
        handicapIndex !== null && current !== null && current !== undefined
          ? Math.round((handicapIndex - current) * 10) / 10
          : null,
    });
  }
  return out;
}

/**
 * The worst differential that still lands the player at or below `targetHi` on
 * their next round, or null if no single round can get them there.
 *
 * Exact, via binary search: the resulting index is monotone non-decreasing in
 * the posted differential, because the index is a mean of the lowest k of the
 * window and every element of that window is monotone in what was posted.
 */
export function differentialNeededFor(
  state: WhsState,
  dayIndex: number,
  targetHi: number
): number | null {
  const reaches = (tenths: number) => {
    const hi = indexAfterDifferential(state, dayIndex, fromTenths(tenths));
    return hi !== null && hi <= targetHi + 1e-9;
  };

  // If even the best imaginable round misses, no single round can do it.
  if (!reaches(MIN_DIFFERENTIAL_TENTHS)) return null;

  let lo = MIN_DIFFERENTIAL_TENTHS; // known to reach
  let hi = WHS_MAX_INDEX_TENTHS + 1; // known not to reach (or beyond the scale)
  if (reaches(WHS_MAX_INDEX_TENTHS)) return fromTenths(WHS_MAX_INDEX_TENTHS);

  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (reaches(mid)) lo = mid;
    else hi = mid;
  }
  return fromTenths(lo);
}

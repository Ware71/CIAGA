/**
 * WHS Handicap Index — the canonical TypeScript mirror of the database engine.
 *
 * SOURCE OF TRUTH: `public.recalc_handicap_profile(uuid)`, last rewritten in
 * supabase/migrations/20260824000000_whs_acceptability_gbi_alignment.sql,
 * together with `ciaga_lowest_of_n_count(int)` and `ciaga_hi_adjustment(int)`
 * (both in 20260120144116_remote_schema.sql, L894 and L862). If those change,
 * this file changes with them and the fixture test in
 * __tests__/replay.fixture.test.ts is what proves the two still agree.
 *
 * Implements Rule 5.2 (best-of-k of the most recent 20 plus the small-sample
 * adjustment), Rule 5.7 (Low Handicap Index, established only at 20 acceptable
 * scores), Rule 5.8 (soft/hard caps) and Rule 5.9 (Exceptional Score
 * Reduction). It consumes an already-filtered differential stream — the
 * decision about which rounds get in is lib/whs/acceptability.ts.
 *
 * Why a TS copy exists at all: the projection engine has to ask "what would this
 * player's Handicap Index be if the next N rounds went like *this*?" thousands
 * of times per page render. That is not a question the database can answer
 * cheaply, and it is not a question you may answer with an approximation — the
 * whole point of the projection rework is that HI is a deterministic order
 * statistic, not a smooth curve.
 *
 * ── Everything is integer TENTHS ──────────────────────────────────────────────
 * Differentials arrive already rounded to 1dp (`ciaga_played9_sd` rounds to 1),
 * so tenths are exact integers. Working in tenths buys two things:
 *
 *   1. No float drift accumulating across a 20-round window.
 *   2. Postgres `round(numeric, 1)` rounds half AWAY FROM ZERO; JavaScript's
 *      `Math.round(x * 10) / 10` rounds half toward +∞. They disagree on every
 *      negative tie — a plus handicapper's −1.25 is −1.3 in Postgres and −1.2 in
 *      JS. `divRoundHalfAwayFromZero` is the only rounding primitive here, and
 *      it matches Postgres.
 *
 * ── Three SQL behaviours that are easy to get subtly wrong ────────────────────
 *
 *   1. LHI is `min(handicap_index)` over the rows ALREADY WRITTEN for the
 *      trailing 365 days — the *capped* column, nulls excluded, and NOT the
 *      stored `low_handicap_index`. Because the current date's row is inserted
 *      afterwards, today's own index never caps itself. A consequence worth
 *      knowing: the stored `low_handicap_index` can be HIGHER than the
 *      `handicap_index` on the same row, on the day a player sets a new low.
 *
 *   2. One history row per DISTINCT played_at, but the SQL walks the record one
 *      differential at a time — it has to, or Rule 5.9 could not judge the
 *      second of two same-day scores against the index the first produced. Only
 *      the last record of a date is written. `postManyInPlace` reproduces this;
 *      `postInPlace` is the one-round shorthand.
 *
 *   3. The 20-round cut is deterministic, ordered by `(played_at, round_id)`.
 *      It was not always: until the GB&I alignment migration the SQL said
 *      `order by played_at desc limit 20` with no tiebreak, so a replay could
 *      move an index by ~0.4 with no new scores. `hasAmbiguousWindowCut`
 *      survives to identify players whose *stored* history was computed under
 *      that ambiguity and has not yet been replayed.
 */

export const WHS_MAX_INDEX_TENTHS = 540; // 54.0
export const WHS_WINDOW = 20;
export const LHI_WINDOW_DAYS = 365;
export const MIN_DIFFERENTIALS_FOR_INDEX = 3;

/**
 * Rule 5.7: a Low Handicap Index is established only once the player has 20
 * acceptable scores. Below that there is no LHI and therefore no soft or hard
 * cap — a new player cannot be capped against a baseline they have not set.
 */
export const LHI_MIN_SCORES = 20;

/** Soft cap starts once base HI exceeds LHI by this much (tenths). */
const SOFT_CAP_THRESHOLD_TENTHS = 30; // 3.0
/** Hard cap pins base HI at LHI plus this much (tenths). */
const HARD_CAP_THRESHOLD_TENTHS = 50; // 5.0

// --- Rule 5.9, Exceptional Score Reduction ---------------------------------
/** A differential this far below the index reduces it by 1.0. */
export const ESR_MINOR_THRESHOLD_TENTHS = 70; // 7.0
/** A differential this far below the index reduces it by 2.0. */
export const ESR_MAJOR_THRESHOLD_TENTHS = 100; // 10.0
const ESR_MINOR_REDUCTION_TENTHS = 10; // -1.0
const ESR_MAJOR_REDUCTION_TENTHS = 20; // -2.0

/**
 * Rule 5.9. The reduction earned by a single differential, judged against the
 * Handicap Index in force at the moment it was posted (null = no index yet, so
 * nothing to be exceptional relative to).
 */
export function esrReductionTenths(
  indexBeforeTenths: number | null,
  diffTenths: number
): number {
  if (indexBeforeTenths === null) return 0;
  const below = indexBeforeTenths - diffTenths;
  if (below >= ESR_MAJOR_THRESHOLD_TENTHS) return ESR_MAJOR_REDUCTION_TENTHS;
  if (below >= ESR_MINOR_THRESHOLD_TENTHS) return ESR_MINOR_REDUCTION_TENTHS;
  return 0;
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/**
 * Integer division rounding halves AWAY FROM ZERO, matching Postgres
 * `round(numeric, n)`. `denom` must be positive.
 */
export function divRoundHalfAwayFromZero(numer: number, denom: number): number {
  if (denom <= 0) throw new Error(`divRoundHalfAwayFromZero: denom must be > 0 (got ${denom})`);
  const sign = numer < 0 ? -1 : 1;
  const abs = Math.abs(numer);
  // `|| 0` normalises -0, which would otherwise reach JSON as "-0" and read as a
  // plus handicap of zero.
  return sign * Math.floor((2 * abs + denom) / (2 * denom)) || 0;
}

/** A 1dp differential (e.g. 12.3) as exact integer tenths (123). */
export function toTenths(value: number): number {
  return Math.round(value * 10);
}

/** Integer tenths back to a 1dp number. */
export function fromTenths(tenths: number): number {
  return tenths / 10;
}

// ---------------------------------------------------------------------------
// Day indices — pure calendar arithmetic, no local timezone anywhere
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 for a `YYYY-MM-DD` date (leading portion of a timestamp is fine). */
export function dayIndexFromISO(dateISO: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO);
  if (!m) throw new Error(`dayIndexFromISO: expected YYYY-MM-DD, got "${dateISO}"`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY);
}

/** Inverse of `dayIndexFromISO`. */
export function isoFromDayIndex(dayIndex: number): string {
  return new Date(dayIndex * MS_PER_DAY).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The WHS tables
// ---------------------------------------------------------------------------

/** Mirrors `public.ciaga_lowest_of_n_count(int)`. */
export function lowestOfNCount(n: number): number {
  if (n <= 0) return 0;
  if (n <= 5) return 1;
  if (n <= 8) return 2;
  if (n <= 11) return 3;
  if (n <= 14) return 4;
  if (n <= 16) return 5;
  if (n <= 18) return 6;
  if (n === 19) return 7;
  return 8;
}

/** Mirrors `public.ciaga_hi_adjustment(int)`, in tenths. */
export function hiAdjustmentTenths(n: number): number {
  if (n === 3) return -20;
  if (n === 4) return -10;
  if (n === 6) return -10;
  return 0;
}

/**
 * Base Handicap Index in tenths from a differential window, or null below the
 * 3-differential minimum. Mirrors the `base_hi` block: mean of the lowest k,
 * plus the small-sample adjustment, rounded to 1dp, then capped at 54.0.
 *
 * `windowTenths` may be in any order — it is copied and sorted here.
 */
/**
 * Reusable scratch for the lowest-k selection. The Monte Carlo calls
 * `baseIndexTenths` on the order of 10^5 times per page render, and allocating
 * plus comparator-sorting a fresh array each time dominated the whole
 * simulation. Safe because nothing here yields between write and read.
 */
const selectionScratch = new Int16Array(WHS_WINDOW);

export function baseIndexTenths(
  windowTenths: readonly number[],
  esrTotalTenths = 0
): number | null {
  const n = windowTenths.length;
  if (n < MIN_DIFFERENTIALS_FOR_INDEX) return null;

  const k = lowestOfNCount(n);
  if (k <= 0) return null;

  for (let i = 0; i < n; i++) selectionScratch[i] = windowTenths[i];

  // Partial selection sort: only the k smallest need to be in place, and with
  // k <= 8 and n <= 20 that is far cheaper than a full sort — and allocates
  // nothing.
  let sum = 0;
  for (let i = 0; i < k; i++) {
    let minIdx = i;
    for (let j = i + 1; j < n; j++) {
      if (selectionScratch[j] < selectionScratch[minIdx]) minIdx = j;
    }
    if (minIdx !== i) {
      const t = selectionScratch[i];
      selectionScratch[i] = selectionScratch[minIdx];
      selectionScratch[minIdx] = t;
    }
    sum += selectionScratch[i];
  }

  // round(avg(lowest k) + adj, 1) == round((sum + adj*k) / k) in tenths.
  // Done as one exact rational rounding so there is no intermediate rounding
  // that Postgres does not also perform.
  const adjTenths = hiAdjustmentTenths(n);
  const base = divRoundHalfAwayFromZero(sum + adjTenths * k, k);

  // Rule 5.9 applies the reduction uniformly to every differential in the
  // window, so subtracting it once from the average of the lowest k gives the
  // identical answer. Reductions are whole tenths, so the SQL's
  // `round(base - esr, 1)` is a no-op here and needs no re-rounding.
  // The 54.0 ceiling is applied AFTER the reduction, matching the SQL order.
  return Math.min(WHS_MAX_INDEX_TENTHS, base - esrTotalTenths);
}

/**
 * Mirrors the LHI soft/hard cap block. `lhiTenths === null` means the player has
 * no prior index in the trailing window, i.e. this is their first ever HI, in
 * which case nothing caps it and the LHI is seeded from the result.
 *
 * `scoreCount` is the number of differentials in the counting window. Rule 5.7
 * establishes a Low Handicap Index only at 20 acceptable scores, so below that
 * there is no LHI to store and no cap to apply. It defaults to `WHS_WINDOW` so
 * callers reasoning about an established player need not pass it.
 *
 * Returns the capped index and the LHI to store alongside it (null while
 * unestablished).
 */
export function applyLhiCapTenths(
  baseTenths: number,
  lhiTenths: number | null,
  scoreCount: number = WHS_WINDOW
): { cappedTenths: number; lhiTenths: number | null } {
  if (scoreCount < LHI_MIN_SCORES) {
    return { cappedTenths: Math.min(WHS_MAX_INDEX_TENTHS, baseTenths), lhiTenths: null };
  }

  if (lhiTenths === null) {
    const capped = Math.min(WHS_MAX_INDEX_TENTHS, baseTenths);
    return { cappedTenths: capped, lhiTenths: capped };
  }

  const lhi = Math.min(WHS_MAX_INDEX_TENTHS, lhiTenths);
  const over = baseTenths - lhi;

  let capped: number;
  if (over <= SOFT_CAP_THRESHOLD_TENTHS) {
    capped = baseTenths;
  } else if (over <= HARD_CAP_THRESHOLD_TENTHS) {
    // round(lhi + 3 + (over - 3) * 0.5, 1) == round((lhi + base + 30) / 2) in tenths.
    capped = divRoundHalfAwayFromZero(lhi + baseTenths + SOFT_CAP_THRESHOLD_TENTHS, 2);
  } else {
    capped = lhi + HARD_CAP_THRESHOLD_TENTHS;
  }

  return { cappedTenths: Math.min(WHS_MAX_INDEX_TENTHS, capped), lhiTenths: lhi };
}

// ---------------------------------------------------------------------------
// Replayable state
// ---------------------------------------------------------------------------

/**
 * Everything needed to post another differential and get the resulting index.
 *
 * Plain arrays rather than typed arrays on purpose: the Monte Carlo clones a
 * state once per simulated path (thousands), not once per simulated round
 * (hundreds of thousands), so `slice()` on two ~20-element and two ~50-element
 * arrays is nowhere near the hot loop, and the readability is worth more.
 */
export type WhsState = {
  /** Last ≤20 differentials in tenths, oldest → newest. */
  windowTenths: number[];
  /** Day index of each windowed differential, parallel to `windowTenths`. */
  windowDays: number[];
  /**
   * Rule 5.9 reduction earned by each windowed differential, parallel to
   * `windowTenths`. A reduction stays in force exactly as long as the
   * exceptional score that earned it stays inside the 20, which is what makes
   * it "dilute over time" without any explicit expiry.
   */
  windowEsrTenths: number[];
  /** Non-null computed indices (tenths) inside the trailing LHI window, oldest → newest. */
  hiTenths: number[];
  /** Day index of each entry in `hiTenths`. */
  hiDays: number[];
  /**
   * The index in force before the next differential is posted — what Rule 5.9
   * judges an exceptional score against. Null while the player has no index.
   */
  prevIndexTenths: number | null;
};

export type DifferentialPost = { dayIndex: number; diffTenths: number };

export function emptyWhsState(): WhsState {
  return {
    windowTenths: [],
    windowDays: [],
    windowEsrTenths: [],
    hiTenths: [],
    hiDays: [],
    prevIndexTenths: null,
  };
}

export function cloneWhsState(s: WhsState): WhsState {
  return {
    windowTenths: s.windowTenths.slice(),
    windowDays: s.windowDays.slice(),
    windowEsrTenths: s.windowEsrTenths.slice(),
    hiTenths: s.hiTenths.slice(),
    hiDays: s.hiDays.slice(),
    prevIndexTenths: s.prevIndexTenths,
  };
}

/**
 * Build state by replaying a differential stream. `stream` must be sorted
 * ascending by day; differentials sharing a day are posted together, exactly as
 * the SQL's per-distinct-date loop does.
 */
export function initWhsState(stream: readonly DifferentialPost[]): WhsState {
  const s = emptyWhsState();
  for (let i = 0; i < stream.length; ) {
    const day = stream[i].dayIndex;
    const sameDay: number[] = [];
    while (i < stream.length && stream[i].dayIndex === day) {
      sameDay.push(stream[i].diffTenths);
      i++;
    }
    postManyInPlace(s, day, sameDay);
  }
  return s;
}

/** Current Handicap Index in tenths, or null when the player has no index yet. */
export function currentIndexTenths(s: WhsState): number | null {
  return s.hiTenths.length ? s.hiTenths[s.hiTenths.length - 1] : null;
}

/** How many differentials are in the counting window right now (0–20). */
export function windowSize(s: WhsState): number {
  return s.windowTenths.length;
}

export type WindowEntry = {
  /** The differential, in strokes. */
  differential: number;
  dayIndex: number;
  /** Whether this one is among the lowest k that actually set the index. */
  counting: boolean;
  /** 0 = oldest in the window, windowSize-1 = newest. */
  position: number;
  /** Rounds that must be posted before this one ages out of the 20. */
  roundsUntilDropOut: number;
};

/**
 * The counting window, newest last, with the lowest-k entries flagged.
 *
 * This is what makes a projection legible: a player's index is set by a handful
 * of specific rounds, and knowing which ones — and when the bad ones age out —
 * explains the forecast far better than the forecast does.
 */
export function countingWindow(s: WhsState): WindowEntry[] {
  const n = s.windowTenths.length;
  if (n === 0) return [];

  const k = lowestOfNCount(n);
  // Rank by value, breaking ties by position so exactly k entries are flagged.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (x, y) => s.windowTenths[x] - s.windowTenths[y] || x - y
  );
  const counting = new Set(order.slice(0, k));

  return Array.from({ length: n }, (_, i) => ({
    differential: fromTenths(s.windowTenths[i]),
    dayIndex: s.windowDays[i],
    counting: counting.has(i),
    position: i,
    // A differential leaves the window when a NEWER one pushes it out, which
    // depends on rounds played, not on days elapsed.
    roundsUntilDropOut: Math.max(0, WHS_WINDOW - (n - 1 - i)),
  }));
}

/**
 * Post one differential. Mutates `s` and returns the resulting index in tenths,
 * or null while the player is still below the 3-differential minimum.
 *
 * Use `postManyInPlace` when several rounds share a date — posting them one at a
 * time would emit an intermediate index the database never produces.
 */
export function postInPlace(s: WhsState, dayIndex: number, diffTenths: number): number | null {
  return postRecord(s, dayIndex, diffTenths).handicapIndexTenths;
}

/**
 * As `postInPlace`, for every differential recorded on a single date.
 *
 * The SQL walks the scoring record one differential at a time — it has to, or
 * Rule 5.9 could not judge the second of two same-day scores against the index
 * the first one produced. Only the LAST record of a date is written to
 * `handicap_index_history`, which `postRecord` reproduces by dropping any row
 * it already wrote for the same day. So the emitted per-date index is
 * unchanged; only the intermediate value the database never stores differs.
 */
export function postManyInPlace(
  s: WhsState,
  dayIndex: number,
  diffsTenths: readonly number[]
): number | null {
  return postDate(s, dayIndex, diffsTenths).handicapIndexTenths;
}

/**
 * Every differential on one date, returning the row the database would store.
 */
function postDate(
  s: WhsState,
  dayIndex: number,
  diffsTenths: readonly number[]
): { handicapIndexTenths: number | null; lowHandicapIndexTenths: number | null } {
  let last: { handicapIndexTenths: number | null; lowHandicapIndexTenths: number | null } = {
    handicapIndexTenths: null,
    lowHandicapIndexTenths: null,
  };
  for (const d of diffsTenths) {
    last = postRecord(s, dayIndex, d);
  }
  return last;
}

/** Post one differential: score it for Rule 5.9, trim, cap, record the row. */
function postRecord(
  s: WhsState,
  dayIndex: number,
  diffTenths: number
): { handicapIndexTenths: number | null; lowHandicapIndexTenths: number | null } {
  // Rule 5.9 is judged against the index in force BEFORE this score.
  s.windowTenths.push(diffTenths);
  s.windowDays.push(dayIndex);
  s.windowEsrTenths.push(esrReductionTenths(s.prevIndexTenths, diffTenths));

  // Manual shift rather than splice: this runs once per simulated round across
  // ~10^5 rounds, and splice reallocates.
  if (s.windowTenths.length > WHS_WINDOW) {
    const excess = s.windowTenths.length - WHS_WINDOW;
    for (let i = 0; i < WHS_WINDOW; i++) {
      s.windowTenths[i] = s.windowTenths[i + excess];
      s.windowDays[i] = s.windowDays[i + excess];
      s.windowEsrTenths[i] = s.windowEsrTenths[i + excess];
    }
    s.windowTenths.length = WHS_WINDOW;
    s.windowDays.length = WHS_WINDOW;
    s.windowEsrTenths.length = WHS_WINDOW;
  }

  let esrTotal = 0;
  for (let i = 0; i < s.windowEsrTenths.length; i++) esrTotal += s.windowEsrTenths[i];

  const base = baseIndexTenths(s.windowTenths, esrTotal);
  if (base === null) {
    // SQL writes a row with NULL index and leaves the LHI history untouched.
    s.prevIndexTenths = null;
    return { handicapIndexTenths: null, lowHandicapIndexTenths: null };
  }

  // Drop any row already recorded for this date, so repeated single posts on one
  // day behave like the SQL's single per-date insert rather than capping against
  // an index the database would never have written.
  while (s.hiDays.length && s.hiDays[s.hiDays.length - 1] === dayIndex) {
    s.hiDays.pop();
    s.hiTenths.pop();
  }

  // LHI window: rows on or after (dayIndex − 365). Day indices are
  // non-decreasing across a replay, so anything pruned here is gone for good.
  const cutoff = dayIndex - LHI_WINDOW_DAYS;
  const len = s.hiDays.length;
  let start = 0;
  while (start < len && s.hiDays[start] < cutoff) start++;
  if (start > 0) {
    const kept = len - start;
    for (let i = 0; i < kept; i++) {
      s.hiDays[i] = s.hiDays[i + start];
      s.hiTenths[i] = s.hiTenths[i + start];
    }
    s.hiDays.length = kept;
    s.hiTenths.length = kept;
  }

  let lhi: number | null = null;
  for (let i = 0; i < s.hiTenths.length; i++) {
    const v = s.hiTenths[i];
    if (lhi === null || v < lhi) lhi = v;
  }

  const { cappedTenths, lhiTenths } = applyLhiCapTenths(base, lhi, s.windowTenths.length);

  s.hiDays.push(dayIndex);
  s.hiTenths.push(cappedTenths);
  s.prevIndexTenths = cappedTenths;

  return { handicapIndexTenths: cappedTenths, lowHandicapIndexTenths: lhiTenths };
}

// ---------------------------------------------------------------------------
// Full historical replay — the SQL-equivalence target
// ---------------------------------------------------------------------------

export type StreamRow = {
  playedAt: string;
  differential: number;
  /**
   * The round this differential came from. The SQL orders the scoring record
   * by `(played_at, round_id)`, so supplying it makes same-day ordering — and
   * therefore the 20-score cut and Rule 5.9 — match exactly. Omit it only when
   * no two rows share a date.
   */
  roundId?: string | null;
};

export type ReplayRow = {
  asOfDate: string;
  handicapIndex: number | null;
  lowHandicapIndex: number | null;
};

/**
 * Reproduce `handicap_index_history` for a player from their differential
 * stream (`ciaga_scoring_record_stream`), one row per distinct played_at.
 *
 * A green fixture test against real captured data is the only thing that makes
 * the rest of the projection engine trustworthy — see the module header.
 */
export function replayHandicapIndex(stream: readonly StreamRow[]): ReplayRow[] {
  const rows = [...stream]
    .filter((r) => Number.isFinite(r.differential))
    .map((r) => ({
      dayIndex: dayIndexFromISO(r.playedAt),
      diffTenths: toTenths(r.differential),
      roundId: r.roundId ?? "",
    }))
    // Matches the SQL's `order by played_at, round_id`.
    .sort((a, b) => a.dayIndex - b.dayIndex || (a.roundId < b.roundId ? -1 : a.roundId > b.roundId ? 1 : 0));

  const s = emptyWhsState();
  const out: ReplayRow[] = [];

  for (let i = 0; i < rows.length; ) {
    const day = rows[i].dayIndex;
    const sameDay: number[] = [];
    while (i < rows.length && rows[i].dayIndex === day) {
      sameDay.push(rows[i].diffTenths);
      i++;
    }

    const { handicapIndexTenths, lowHandicapIndexTenths } = postDate(s, day, sameDay);
    out.push({
      asOfDate: isoFromDayIndex(day),
      handicapIndex: handicapIndexTenths === null ? null : fromTenths(handicapIndexTenths),
      lowHandicapIndex:
        lowHandicapIndexTenths === null ? null : fromTenths(lowHandicapIndexTenths),
    });
  }

  return out;
}

/**
 * Day indices whose STORED Handicap Index the database could not pin down
 * uniquely, back when the 20-round cut had no tiebreak.
 *
 * `recalc_handicap_profile` used to select the counting window with
 * `order by played_at desc limit 20`, and `played_at` is a DATE. So whenever
 * the cut landed inside a group of differentials sharing a date, Postgres kept
 * an arbitrary subset and the resulting index depended on physical row order —
 * re-running the recalc could move a player's index without any new scores.
 * Observed range on real data: ~0.4.
 *
 * The SQL now orders by `(played_at, round_id)`, so newly computed history is
 * deterministic. This helper remains useful for one thing: identifying players
 * whose stored rows predate the fix and therefore may not match a fresh replay
 * until `ciaga_refresh_handicaps_from(null)` has been run.
 */
export function ambiguousCutDays(stream: readonly StreamRow[]): Set<number> {
  const days = [...stream]
    .filter((r) => Number.isFinite(r.differential))
    .map((r) => dayIndexFromISO(r.playedAt))
    .sort((a, b) => a - b);

  const out = new Set<number>();
  // The SQL only ever queries prefixes that end on a date boundary (every row
  // for a date is included), so only those prefixes can expose the ambiguity.
  for (let end = WHS_WINDOW + 1; end <= days.length; end++) {
    const endsOnDateBoundary = end === days.length || days[end - 1] !== days[end];
    if (!endsOnDateBoundary) continue;
    const cutIdx = end - WHS_WINDOW; // first index kept
    if (days[cutIdx] === days[cutIdx - 1]) out.add(days[end - 1]);
  }
  return out;
}

/** Convenience wrapper over {@link ambiguousCutDays}. */
export function hasAmbiguousWindowCut(stream: readonly StreamRow[]): boolean {
  return ambiguousCutDays(stream).size > 0;
}

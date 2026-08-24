import { describe, expect, it } from "vitest";
import {
  applyLhiCapTenths,
  baseIndexTenths,
  cloneWhsState,
  currentIndexTenths,
  dayIndexFromISO,
  divRoundHalfAwayFromZero,
  emptyWhsState,
  hasAmbiguousWindowCut,
  hiAdjustmentTenths,
  initWhsState,
  isoFromDayIndex,
  lowestOfNCount,
  postInPlace,
  postManyInPlace,
  replayHandicapIndex,
  toTenths,
  windowSize,
  WHS_MAX_INDEX_TENTHS,
} from "../handicapIndex";

// The literal CASE from public.ciaga_lowest_of_n_count, transcribed by hand from
// the migration so a change to either side breaks the test rather than silently
// agreeing with a copied bug.
const LOWEST_OF_N: number[] = [
  /* 0 */ 0, /* 1 */ 1, /* 2 */ 1, /* 3 */ 1, /* 4 */ 1, /* 5 */ 1,
  /* 6 */ 2, /* 7 */ 2, /* 8 */ 2,
  /* 9 */ 3, /* 10 */ 3, /* 11 */ 3,
  /* 12 */ 4, /* 13 */ 4, /* 14 */ 4,
  /* 15 */ 5, /* 16 */ 5,
  /* 17 */ 6, /* 18 */ 6,
  /* 19 */ 7,
  /* 20 */ 8, /* 21 */ 8, /* 22 */ 8, /* 23 */ 8, /* 24 */ 8, /* 25 */ 8,
];

describe("lowestOfNCount", () => {
  it("matches ciaga_lowest_of_n_count for n = 0..25", () => {
    for (let n = 0; n <= 25; n++) {
      expect(lowestOfNCount(n), `n=${n}`).toBe(LOWEST_OF_N[n]);
    }
  });
});

describe("hiAdjustmentTenths", () => {
  it("matches ciaga_hi_adjustment for n = 1..25", () => {
    for (let n = 1; n <= 25; n++) {
      const expected = n === 3 ? -20 : n === 4 || n === 6 ? -10 : 0;
      expect(hiAdjustmentTenths(n), `n=${n}`).toBe(expected);
    }
  });
});

describe("divRoundHalfAwayFromZero", () => {
  it("rounds halves away from zero like Postgres round(numeric, n)", () => {
    expect(divRoundHalfAwayFromZero(25, 2)).toBe(13);
    expect(divRoundHalfAwayFromZero(-25, 2)).toBe(-13); // JS Math.round would give -12
    expect(divRoundHalfAwayFromZero(23, 2)).toBe(12);
    expect(divRoundHalfAwayFromZero(-23, 2)).toBe(-12);
    expect(divRoundHalfAwayFromZero(24, 2)).toBe(12);
  });

  it("is exact for every denominator the WHS tables can produce", () => {
    // k is never outside 1..8, so this covers the whole reachable space.
    for (let denom = 1; denom <= 8; denom++) {
      for (let numer = -200; numer <= 200; numer++) {
        const exact = numer / denom;
        const expected = Math.sign(exact) * Math.round(Math.abs(exact));
        expect(divRoundHalfAwayFromZero(numer, denom), `${numer}/${denom}`).toBe(expected || 0);
      }
    }
  });

  it("rejects a non-positive denominator rather than returning nonsense", () => {
    expect(() => divRoundHalfAwayFromZero(10, 0)).toThrow();
  });
});

describe("baseIndexTenths", () => {
  it("returns null below the three-differential minimum", () => {
    expect(baseIndexTenths([])).toBeNull();
    expect(baseIndexTenths([100])).toBeNull();
    expect(baseIndexTenths([100, 120])).toBeNull();
  });

  it("applies the small-sample adjustment", () => {
    // n=3 → lowest 1, adj -2.0
    expect(baseIndexTenths([100, 120, 140])).toBe(80);
    // n=4 → lowest 1, adj -1.0
    expect(baseIndexTenths([100, 120, 140, 160])).toBe(90);
    // n=5 → lowest 1, no adjustment
    expect(baseIndexTenths([100, 120, 140, 160, 180])).toBe(100);
    // n=6 → lowest 2, adj -1.0 → mean(10.0, 12.0) - 1.0 = 10.0
    expect(baseIndexTenths([100, 120, 140, 160, 180, 200])).toBe(100);
  });

  it("HI RISES on an extra worse round, purely from the adjustment table", () => {
    // This is the mechanical drift the old exponential model read as a "trend"
    // and extrapolated forever. Same three scores, one worse round appended.
    const three = baseIndexTenths([100, 120, 140])!;
    const four = baseIndexTenths([100, 120, 140, 160])!;
    expect(three).toBe(80);
    expect(four).toBe(90);
    expect(four).toBeGreaterThan(three);
  });

  it("drifts upward from best-1-of-5 to best-8-of-20 for a stationary player", () => {
    // 20 differentials all drawn from the same flat spread. Ability is constant;
    // only k and adj move.
    const all = [90, 95, 100, 105, 110, 115, 120, 125, 130, 135,
                 140, 145, 150, 155, 160, 165, 170, 175, 180, 185];
    const atFive = baseIndexTenths(all.slice(0, 5))!;
    const atTwenty = baseIndexTenths(all)!;
    expect(atTwenty).toBeGreaterThan(atFive);
  });

  it("ignores input order", () => {
    expect(baseIndexTenths([140, 100, 120])).toBe(baseIndexTenths([100, 120, 140]));
  });

  it("caps at 54.0", () => {
    const awful = new Array(20).fill(600); // 60.0 each
    expect(baseIndexTenths(awful)).toBe(WHS_MAX_INDEX_TENTHS);
  });

  it("handles plus handicaps without a rounding disagreement", () => {
    // lowest 2 of 8 = -1.2 and -1.3 → mean -1.25 → Postgres rounds to -1.3.
    const window = [-12, -13, 20, 30, 40, 50, 60, 70];
    expect(baseIndexTenths(window)).toBe(-13);
  });
});

describe("applyLhiCapTenths", () => {
  it("does not cap a first-ever index and seeds the LHI from it", () => {
    expect(applyLhiCapTenths(140, null)).toEqual({ cappedTenths: 140, lhiTenths: 140 });
  });

  it("leaves an index within 3.0 of the LHI alone", () => {
    expect(applyLhiCapTenths(130, 100).cappedTenths).toBe(130); // over = 3.0 exactly
    expect(applyLhiCapTenths(120, 100).cappedTenths).toBe(120);
  });

  it("soft-caps between 3.0 and 5.0 over the LHI", () => {
    // lhi 10.0, base 14.0 → 10 + 3 + (4-3)*0.5 = 13.5
    expect(applyLhiCapTenths(140, 100).cappedTenths).toBe(135);
    // lhi 10.0, base 13.5 → 10 + 3 + 0.25 = 13.25 → Postgres round(...,1) = 13.3
    expect(applyLhiCapTenths(135, 100).cappedTenths).toBe(133);
  });

  it("hard-caps beyond 5.0 over the LHI", () => {
    expect(applyLhiCapTenths(200, 100).cappedTenths).toBe(150);
  });

  it("uses the soft formula at exactly 5.0 over, which lands at LHI + 4.0", () => {
    // The `elsif over_lhi <= 5` branch owns the boundary, so an index 5.0 over
    // the LHI is capped to 10 + 3 + (5-3)*0.5 = 14.0 — NOT the LHI + 5.0 = 15.0
    // the "hard cap" name suggests. Only strictly-over-5.0 reaches LHI + 5.0.
    expect(applyLhiCapTenths(150, 100).cappedTenths).toBe(140);
    expect(applyLhiCapTenths(151, 100).cappedTenths).toBe(150);
  });

  it("keeps the 54.0 ceiling above the cap logic", () => {
    expect(applyLhiCapTenths(600, 530).cappedTenths).toBe(WHS_MAX_INDEX_TENTHS);
  });
});

describe("day index helpers", () => {
  it("round-trips ISO dates", () => {
    for (const d of ["1970-01-01", "2026-01-01", "2026-02-29", "2026-08-23", "2024-12-31"]) {
      // 2026 is not a leap year, so 2026-02-29 normalises to 2026-03-01 — assert
      // the round trip is stable rather than that it is the same string.
      expect(isoFromDayIndex(dayIndexFromISO(isoFromDayIndex(dayIndexFromISO(d))))).toBe(
        isoFromDayIndex(dayIndexFromISO(d))
      );
    }
    expect(isoFromDayIndex(dayIndexFromISO("2026-08-23"))).toBe("2026-08-23");
    expect(dayIndexFromISO("1970-01-01")).toBe(0);
    expect(dayIndexFromISO("1970-01-02")).toBe(1);
  });

  it("accepts a full timestamp and uses its date part", () => {
    expect(dayIndexFromISO("2026-08-23T18:30:00+01:00")).toBe(dayIndexFromISO("2026-08-23"));
  });

  it("rejects a malformed date instead of silently returning NaN", () => {
    expect(() => dayIndexFromISO("23/08/2026")).toThrow();
  });
});

describe("WhsState posting", () => {
  const day = (iso: string) => dayIndexFromISO(iso);

  it("returns null until the third differential", () => {
    const s = emptyWhsState();
    expect(postInPlace(s, day("2026-01-01"), 100)).toBeNull();
    expect(postInPlace(s, day("2026-01-08"), 120)).toBeNull();
    expect(postInPlace(s, day("2026-01-15"), 140)).toBe(80);
    expect(currentIndexTenths(s)).toBe(80);
  });

  it("keeps only the newest 20 differentials", () => {
    const s = emptyWhsState();
    for (let i = 0; i < 25; i++) postInPlace(s, day("2026-01-01") + i * 7, 100 + i);
    expect(windowSize(s)).toBe(20);
    expect(s.windowTenths[0]).toBe(105); // the first five aged out
    expect(s.windowTenths[19]).toBe(124);
  });

  it("treats same-day rounds as one posting, like the SQL's per-date loop", () => {
    const d = day("2026-03-01");

    const batched = emptyWhsState();
    postInPlace(batched, day("2026-01-01"), 100);
    postInPlace(batched, day("2026-02-01"), 120);
    const batchedHi = postManyInPlace(batched, d, [140, 160]);

    // Posting the same two rounds one at a time must land in the same place —
    // the intermediate index the SQL never emits must not linger in the LHI
    // history and cap the real one.
    const stepwise = emptyWhsState();
    postInPlace(stepwise, day("2026-01-01"), 100);
    postInPlace(stepwise, day("2026-02-01"), 120);
    postInPlace(stepwise, d, 140);
    const stepwiseHi = postInPlace(stepwise, d, 160);

    expect(batchedHi).toBe(stepwiseHi);
    expect(stepwise.hiDays.filter((x) => x === d)).toHaveLength(1);
  });

  it("caps against the trailing-365-day low, and lets the low expire", () => {
    const s = emptyWhsState();
    // Establish a low index of 8.0.
    postInPlace(s, day("2026-01-01"), 100);
    postInPlace(s, day("2026-01-02"), 120);
    expect(postInPlace(s, day("2026-01-03"), 140)).toBe(80);

    // Immediately post a run of terrible rounds: the hard cap pins the index at
    // LHI + 5.0 = 13.0 no matter how bad they are.
    for (let i = 0; i < 20; i++) postInPlace(s, day("2026-01-10") + i, 400);
    expect(currentIndexTenths(s)).toBe(130);

    // Well over a year later the old low has expired, so the cap lifts.
    for (let i = 0; i < 20; i++) postInPlace(s, day("2027-06-01") + i, 400);
    expect(currentIndexTenths(s)).toBeGreaterThan(130);
  });

  it("clones without sharing state", () => {
    const s = initWhsState([
      { dayIndex: day("2026-01-01"), diffTenths: 100 },
      { dayIndex: day("2026-01-02"), diffTenths: 120 },
      { dayIndex: day("2026-01-03"), diffTenths: 140 },
    ]);
    const copy = cloneWhsState(s);
    postInPlace(copy, day("2026-01-04"), 500);

    expect(currentIndexTenths(s)).toBe(80);
    expect(windowSize(s)).toBe(3);
    expect(windowSize(copy)).toBe(4);
  });
});

describe("replayHandicapIndex", () => {
  it("emits one row per distinct played_at, nulls included", () => {
    const rows = replayHandicapIndex([
      { playedAt: "2026-01-01", differential: 10.0 },
      { playedAt: "2026-01-08", differential: 12.0 },
      { playedAt: "2026-01-15", differential: 14.0 },
    ]);

    expect(rows).toEqual([
      { asOfDate: "2026-01-01", handicapIndex: null, lowHandicapIndex: null },
      { asOfDate: "2026-01-08", handicapIndex: null, lowHandicapIndex: null },
      { asOfDate: "2026-01-15", handicapIndex: 8.0, lowHandicapIndex: 8.0 },
    ]);
  });

  it("collapses same-day rounds into a single row", () => {
    const rows = replayHandicapIndex([
      { playedAt: "2026-01-01", differential: 10.0 },
      { playedAt: "2026-01-08", differential: 12.0 },
      { playedAt: "2026-01-15", differential: 14.0 },
      { playedAt: "2026-01-15", differential: 9.0 },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[2].asOfDate).toBe("2026-01-15");
    // n=4 → lowest 1 (9.0) with adj -1.0
    expect(rows[2].handicapIndex).toBe(8.0);
  });

  it("stores an LHI that can sit above the index on a new-low day", () => {
    const rows = replayHandicapIndex([
      { playedAt: "2026-01-01", differential: 20.0 },
      { playedAt: "2026-01-08", differential: 20.0 },
      { playedAt: "2026-01-15", differential: 20.0 },
      { playedAt: "2026-01-22", differential: 2.0 },
    ]);
    const newLowDay = rows[3];
    // The stored low_handicap_index is the min of PRIOR rows, so on the day the
    // player sets a new low it is higher than the index itself. Quirk of the SQL,
    // mirrored deliberately.
    expect(newLowDay.handicapIndex!).toBeLessThan(newLowDay.lowHandicapIndex!);
  });

  it("sorts an out-of-order stream before replaying", () => {
    const ordered = replayHandicapIndex([
      { playedAt: "2026-01-01", differential: 10.0 },
      { playedAt: "2026-01-08", differential: 12.0 },
      { playedAt: "2026-01-15", differential: 14.0 },
    ]);
    const shuffled = replayHandicapIndex([
      { playedAt: "2026-01-15", differential: 14.0 },
      { playedAt: "2026-01-01", differential: 10.0 },
      { playedAt: "2026-01-08", differential: 12.0 },
    ]);
    expect(shuffled).toEqual(ordered);
  });
});

describe("hasAmbiguousWindowCut", () => {
  it("is false when every date carries one differential", () => {
    const stream = Array.from({ length: 30 }, (_, i) => ({
      playedAt: isoFromDayIndex(dayIndexFromISO("2026-01-01") + i),
      differential: 10 + i,
    }));
    expect(hasAmbiguousWindowCut(stream)).toBe(false);
  });

  it("is true when the newest-20 cut falls inside a shared date", () => {
    // 22 differentials; the two oldest share a date, so the 20-cut splits them.
    const stream = [
      { playedAt: "2026-01-01", differential: 10 },
      { playedAt: "2026-01-01", differential: 11 },
      ...Array.from({ length: 20 }, (_, i) => ({
        playedAt: isoFromDayIndex(dayIndexFromISO("2026-02-01") + i),
        differential: 12 + i,
      })),
    ];
    expect(hasAmbiguousWindowCut(stream)).toBe(true);
  });
});

describe("toTenths", () => {
  it("is exact for 1dp values on both sides of zero", () => {
    expect(toTenths(12.3)).toBe(123);
    expect(toTenths(-12.3)).toBe(-123);
    expect(toTenths(0)).toBe(0);
    expect(toTenths(54)).toBe(540);
  });
});

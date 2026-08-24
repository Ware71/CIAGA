import { describe, expect, it } from "vitest";
import { buildProjection, priorSigmaFor } from "../simulate";
import { mulberry32, nextNormal } from "@/lib/fantasy/simulation/rng";
import { dayIndexFromISO, isoFromDayIndex } from "@/lib/whs/handicapIndex";
import type { DiffPoint } from "@/lib/stats/projectionData";

const TODAY = new Date(2026, 7, 23); // 2026-08-23, local
const TODAY_IDX = dayIndexFromISO("2026-08-23");

/** `count` differentials from N(mean, sd), one every `everyDays` days, ending today. */
function stream(
  count: number,
  mean: number,
  sd: number,
  everyDays = 14,
  seed = 42,
  trendPerRound = 0
): DiffPoint[] {
  const rand = mulberry32(seed);
  const out: DiffPoint[] = [];
  for (let i = 0; i < count; i++) {
    // i = 0 is the OLDEST round.
    const roundsFromNewest = count - 1 - i;
    const mu = mean + trendPerRound * roundsFromNewest;
    out.push({
      d: isoFromDayIndex(TODAY_IDX - roundsFromNewest * everyDays),
      v: Math.round((mu + nextNormal(rand) * sd) * 10) / 10,
    });
  }
  return out;
}

const dateIn = (days: number) => isoFromDayIndex(TODAY_IDX + days);

describe("degradation ladder", () => {
  it("reports what it can do at each data level", () => {
    expect(buildProjection({ stream: [], today: TODAY }).status).toBe("no_data");
    expect(buildProjection({ stream: stream(2, 15, 3), today: TODAY }).status).toBe("pre_index");
    expect(buildProjection({ stream: stream(5, 15, 3), today: TODAY }).status).toBe("mechanical");
    expect(buildProjection({ stream: stream(12, 15, 3), today: TODAY }).status).toBe("simulated");
  });

  it("returns an empty fan rather than a fabricated one below the simulate threshold", () => {
    const p = buildProjection({ stream: stream(5, 15, 3), today: TODAY });
    expect(p.fan).toHaveLength(0);
    expect(p.realisticFloor).toBeNull();
    expect(p.probReachBy(12, dateIn(180))).toBeNull();
    // But the WHS state is still there — "what does my next round do" works.
    expect(p.currentHi).not.toBeNull();
  });
});

describe("determinism", () => {
  it("gives identical results for the same seed key", () => {
    const s = stream(30, 15, 3);
    const a = buildProjection({ stream: s, today: TODAY, sims: 400, seedKey: "x" });
    const b = buildProjection({ stream: s, today: TODAY, sims: 400, seedKey: "x" });
    expect(a.fan).toEqual(b.fan);
    expect(a.realisticFloor).toEqual(b.realisticFloor);
  });
});

describe("a player of constant ability", () => {
  const s = stream(40, 15, 3);
  const p = buildProjection({ stream: s, today: TODAY, sims: 1200, seedKey: "stationary" });

  it("does not extrapolate a trend that is only noise", () => {
    expect(p.diagnostics.trendApplied).toBe(false);
  });

  it("still improves, because the population curve says players at this level do", () => {
    // The old model could not express sustained improvement at all: its momentum
    // term died within a dozen rounds, so every projection flatlined inside six
    // months. Improvement now comes from level and experience — see
    // ../improvement.ts and scripts/measure-improvement.mjs.
    const start = p.fan[0].p50;
    const end = p.fan[p.fan.length - 1].p50;
    expect(end).toBeLessThan(start - 1.0);
  });

  it("never projects below the floor prior", () => {
    for (const f of p.fan) expect(f.p10).toBeGreaterThan(-6);
  });
});

describe("headroom, not mileage, governs improvement", () => {
  // Averaged over seeds: with a short history it is largely luck where a
  // player's best-8-of-20 sits relative to their true level, and that offset
  // alone moves a single run by a stroke either way.
  const meanDrop = (rounds: number, level: number, seeds = [3, 5, 7, 11]) => {
    const drops = seeds.map((seed) => {
      const p = buildProjection({
        stream: stream(rounds, level, 3, 14, seed),
        today: TODAY,
        sims: 600,
        seedKey: `hr-${rounds}-${seed}`,
      });
      return p.fan[0].p50 - p.fan[p.fan.length - 1].p50;
    });
    return drops.reduce((a, b) => a + b, 0) / drops.length;
  };

  it("treats a 250-round veteran the same as a newcomer at the same level", () => {
    // The model briefly carried an exp(-n/N0) experience factor. It was removed
    // on evidence (scripts/test-experience-term.mjs): rounds-played correlates
    // -0.67 with level so it was re-explaining headroom, the headroom-only
    // residuals correlate with it at 0.067, and within the player with the most
    // history the rate per stroke of headroom got FASTER after 100+ rounds.
    const green = meanDrop(20, 15);
    const veteran = meanDrop(250, 15);
    expect(Math.abs(green - veteran)).toBeLessThan(2.0);
  });

  it("improves a player with more headroom more", () => {
    expect(meanDrop(60, 25)).toBeGreaterThan(meanDrop(60, 13) + 1.0);
  });

  it("leaves a player already at their ceiling flat", () => {
    // REGRESSION for two bugs that shipped together:
    //   1. The bootstrap residual pool was built by extrapolating a
    //      recency-weighted trend line across the ENTIRE history, leaving it
    //      systematically signed. Every simulated round inherited that bias.
    //   2. `levelNow` applied `mean - slope x rMean` with the RAW slope, so slope
    //      noise was multiplied by a ~28-round lever arm into the starting level.
    // A scratch-ish player has essentially no headroom, so the improvement term
    // is switched off for them and ANY drift here is one of those bugs coming
    // back. Previously this player was marched from 3.8 to 1.4.
    const drop = meanDrop(250, 4, [3, 5, 7]);
    expect(Math.abs(drop)).toBeLessThan(1.0);
  });

  it("keeps a low-handicap player's scratch odds modest", () => {
    const low = buildProjection({
      stream: stream(250, 8, 2.5, 14, 9),
      today: TODAY,
      sims: 800,
      seedKey: "low-vet",
    });
    // Not the 69% the biased residual pool produced.
    expect(low.probReachBy(0, dateIn(1826)) ?? 0).toBeLessThan(0.5);
  });
});

describe("small-sample mechanical drift", () => {
  it("shows the index rising before improvement overtakes it", () => {
    // Eight differentials: the index today is best-2-of-8; by round 20 it is
    // best-8-of-20, a worse number for identical golf. That rise is arithmetic.
    // It is still there, but for a newcomer the improvement curve overtakes it —
    // which is why this asserts on the near term rather than the whole horizon.
    const p = buildProjection({
      stream: stream(8, 15, 3, 10),
      today: TODAY,
      sims: 1200,
      gridDays: 7,
      seedKey: "drift",
    });
    expect(p.status).toBe("simulated");

    const start = p.fan[0].p50;
    const nearTerm = Math.max(...p.fan.slice(0, 30).map((f) => f.p50));
    expect(nearTerm).toBeGreaterThan(start);
  });
});

describe("uncertainty", () => {
  const p = buildProjection({ stream: stream(40, 15, 3), today: TODAY, sims: 1200, seedKey: "fan" });

  it("widens with horizon", () => {
    const width = (i: number) => p.fan[i].p90 - p.fan[i].p10;
    // Compare across a decent span rather than adjacent points, which can tie
    // when no round falls between two weekly grid points.
    expect(width(p.fan.length - 1)).toBeGreaterThan(width(1));
    expect(width(Math.floor(p.fan.length / 2))).toBeGreaterThanOrEqual(width(1));
  });

  it("keeps the quantiles ordered", () => {
    for (const f of p.fan) {
      expect(f.p10).toBeLessThanOrEqual(f.p25);
      expect(f.p25).toBeLessThanOrEqual(f.p50);
      expect(f.p50).toBeLessThanOrEqual(f.p75);
      expect(f.p75).toBeLessThanOrEqual(f.p90);
    }
  });
});

describe("WHS caps bind the simulation", () => {
  it("never lets a path exceed the low index plus 5.0, or 54.0", () => {
    // A good player who then posts nothing but disasters.
    const good = stream(25, 8, 2, 14, 7);
    const p = buildProjection({
      stream: good,
      today: TODAY,
      sims: 600,
      seedKey: "cap",
      horizonDays: 300,
    });

    const lowIndex = Math.min(...p.fan.map((f) => f.p10), p.currentHi ?? Infinity);
    for (const f of p.fan) {
      expect(f.p90).toBeLessThanOrEqual(lowIndex + 5.0 + 1e-6);
      expect(f.p90).toBeLessThanOrEqual(54.0);
    }
  });
});

describe("cadence drives the projection, not the calendar", () => {
  it("moves further by the same DATE when the player plays more often", () => {
    // Identical scoring, different play rate. A calendar-time model cannot tell
    // these apart; a rounds-based one must.
    const improving = (everyDays: number) => stream(30, 15, 3, everyDays, 11, 0.12);

    const frequent = buildProjection({
      stream: improving(7),
      today: TODAY,
      sims: 900,
      seedKey: "fast",
    });
    const occasional = buildProjection({
      stream: improving(45),
      today: TODAY,
      sims: 900,
      seedKey: "slow",
    });

    expect(frequent.diagnostics.roundsPerYear).toBeGreaterThan(
      occasional.diagnostics.roundsPerYear * 3
    );

    const spread = (p: typeof frequent, i: number) => p.fan[i].p90 - p.fan[i].p10;
    const last = frequent.fan.length - 1;
    expect(spread(frequent, last)).toBeGreaterThan(spread(occasional, last));
  });
});

describe("probabilities", () => {
  const p = buildProjection({ stream: stream(40, 15, 3), today: TODAY, sims: 1200, seedKey: "prob" });

  it("reach-by is never below below-at — they are different questions", () => {
    for (const days of [30, 120, 365, 700]) {
      for (const target of [10, 12, 14, 16]) {
        const reach = p.probReachBy(target, dateIn(days))!;
        const at = p.probBelowAt(target, dateIn(days))!;
        expect(reach).toBeGreaterThanOrEqual(at - 1e-9);
      }
    }
  });

  it("is monotone in both the date and the target", () => {
    let prev = -1;
    for (const days of [30, 120, 365, 700]) {
      const v = p.probReachBy(12, dateIn(days))!;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }

    let prevT = -1;
    for (const target of [8, 10, 12, 14, 16]) {
      const v = p.probReachBy(target, dateIn(365))!;
      expect(v).toBeGreaterThanOrEqual(prevT - 1e-9);
      prevT = v;
    }
  });

  it("returns null outside the simulated horizon rather than guessing", () => {
    expect(p.probReachBy(12, dateIn(5000))).toBeNull();
    expect(p.hiAtDate(dateIn(5000))).toBeNull();
  });

  it("answers ON the horizon date itself, at every grid resolution", () => {
    // The grid steps in whole `gridDays`, so a horizon that is not a multiple of
    // the step used to land short and reject the furthest date the UI offers.
    for (const gridDays of [7, 30, 45]) {
      for (const horizonDays of [730, 365, 100]) {
        const q = buildProjection({
          stream: stream(30, 15, 3),
          today: TODAY,
          sims: 100,
          gridDays,
          horizonDays,
          seedKey: "horizon",
        });
        const label = `grid=${gridDays} horizon=${horizonDays}`;
        expect(q.hiAtDate(dateIn(horizonDays)), label).not.toBeNull();
        expect(q.probReachBy(12, dateIn(horizonDays)), label).not.toBeNull();
        expect(q.probBelowAt(12, dateIn(horizonDays)), label).not.toBeNull();
      }
    }
  });

  it("is certain about a target the player has already passed", () => {
    expect(p.probReachBy(p.currentHi! + 5, dateIn(30))!).toBe(1);
  });
});

describe("etaDistribution", () => {
  const p = buildProjection({
    stream: stream(40, 18, 3, 10, 5, 0.15),
    today: TODAY,
    sims: 1200,
    seedKey: "eta",
  });

  it("orders its quantiles and agrees with probReachBy", () => {
    const target = p.currentHi! - 1;
    const eta = p.etaDistribution(target);
    expect(eta.probEver).toBeGreaterThan(0);
    if (eta.p50Days !== null) {
      expect(eta.p10Days!).toBeLessThanOrEqual(eta.p50Days);
      const atMedian = p.probReachBy(target, dateIn(eta.p50Days))!;
      expect(atMedian).toBeGreaterThanOrEqual(0.5 - 0.05);
    }
  });

  it("withholds a median when fewer than half the paths ever get there", () => {
    const eta = p.etaDistribution(p.currentHi! - 15);
    expect(eta.probEver).toBeLessThan(0.5);
    expect(eta.p50Days).toBeNull();
  });
});

describe("priorSigmaFor", () => {
  it("widens with handicap and copes with a missing index", () => {
    expect(priorSigmaFor(0)).toBeLessThan(priorSigmaFor(28));
    expect(priorSigmaFor(null)).toBeGreaterThan(0);
    expect(priorSigmaFor(-3)).toBe(priorSigmaFor(0));
  });
});

describe("head-to-head", () => {
  // Replaced a "your trends cross on DATE" readout that intersected two fitted
  // curves — a date with no uncertainty attached.
  const strong = buildProjection({ stream: stream(40, 10, 3), today: TODAY, sims: 800, seedKey: "strong" });
  const weak = buildProjection({ stream: stream(40, 22, 3), today: TODAY, sims: 800, seedKey: "weak" });
  const when = dateIn(730);

  it("gives the better player the higher chance of being lower", () => {
    const p = strong.probBelowOther(weak, when)!;
    expect(p).toBeGreaterThan(0.75);
  });

  it("is symmetric — the two probabilities sum to one", () => {
    // Ties are split evenly, so two golfers can never both be under 50%.
    const a = strong.probBelowOther(weak, when)!;
    const b = weak.probBelowOther(strong, when)!;
    expect(a + b).toBeCloseTo(1, 6);
  });

  it("gives a player an even chance against their own twin", () => {
    const twin = buildProjection({ stream: stream(40, 15, 3), today: TODAY, sims: 800, seedKey: "twin-a" });
    const other = buildProjection({ stream: stream(40, 15, 3), today: TODAY, sims: 800, seedKey: "twin-b" });
    expect(twin.probBelowOther(other, when)!).toBeGreaterThan(0.35);
    expect(twin.probBelowOther(other, when)!).toBeLessThan(0.65);
  });

  it("copes with players simulated at different path counts", () => {
    // `sims` scales with cadence, so two players routinely have different path
    // counts. An index-pairing estimator would have needed them equal.
    const few = buildProjection({ stream: stream(40, 10, 3), today: TODAY, sims: 300, seedKey: "few" });
    const many = buildProjection({ stream: stream(40, 22, 3), today: TODAY, sims: 1000, seedKey: "many" });
    expect(few.diagnostics.sims).not.toBe(many.diagnostics.sims);

    const a = few.probBelowOther(many, when)!;
    expect(a).toBeGreaterThan(0.75);
    expect(a + many.probBelowOther(few, when)!).toBeCloseTo(1, 6);
  });

  it("returns null outside the horizon, and for an unprojectable player", () => {
    expect(strong.probBelowOther(weak, dateIn(5000))).toBeNull();
    const thin = buildProjection({ stream: stream(4, 15, 3), today: TODAY, seedKey: "thin" });
    expect(strong.probBelowOther(thin, when)).toBeNull();
    expect(thin.probBelowOther(strong, when)).toBeNull();
  });

  it("exposes sorted samples", () => {
    const s = strong.samplesAt(when)!;
    expect(s.length).toBe(strong.diagnostics.sims);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
  });
});

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

  it("is not projected to keep improving", () => {
    // The exponential fit this replaces ALWAYS projected improvement — its
    // asymptote was constrained to sit a full stroke below the player's current
    // index, so a flat player was told they would get better regardless.
    const start = p.fan[0].p50;
    const end = p.fan[p.fan.length - 1].p50;
    expect(Math.abs(end - start)).toBeLessThan(1.0);
  });

  it("settles near the best-8-of-20 mean of its own scoring distribution", () => {
    // E[mean of the 8 lowest of 20 standard normals] ≈ −0.9 sd.
    const expected = 15 - 0.9 * 3;
    expect(p.realisticFloor!.p50).toBeGreaterThan(expected - 1.5);
    expect(p.realisticFloor!.p50).toBeLessThan(expected + 1.5);
  });

  it("does not extrapolate a trend that is only noise", () => {
    expect(p.diagnostics.trendApplied).toBe(false);
  });
});

describe("small-sample mechanical drift", () => {
  it("projects a NEWER player's index to rise, because k and the adjustment move", () => {
    // Exactly 8 differentials of constant ability. The index today is built from
    // best-2-of-8; by round 20 it will be best-8-of-20, which is a worse (higher)
    // number for the same player. That rise is arithmetic, not form — and the
    // old curve fit read it as a trend and extrapolated it the wrong way.
    const p = buildProjection({
      stream: stream(8, 15, 3, 10),
      today: TODAY,
      sims: 1200,
      seedKey: "drift",
    });
    expect(p.status).toBe("simulated");
    const start = p.fan[0].p50;
    const later = p.fan[Math.floor(p.fan.length / 2)].p50;
    expect(later).toBeGreaterThan(start);
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

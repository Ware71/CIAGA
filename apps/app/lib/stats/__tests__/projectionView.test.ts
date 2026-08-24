import { describe, expect, it } from "vitest";
import {
  clampToHorizon,
  confidenceOf,
  directionOf,
  goalOutlook,
  hiLabel,
  hiValue,
  horizonLabel,
  percentLabel,
  projectedHiOn,
  readiness,
  realisticFloor,
  trendPerRoundLabel,
  HORIZON_DAYS,
} from "../projectionView";
import { buildProjection } from "../projection/simulate";
import { mulberry32, nextNormal } from "@/lib/fantasy/simulation/rng";
import { dayIndexFromISO, isoFromDayIndex } from "@/lib/whs/handicapIndex";
import type { DiffPoint } from "../projectionData";

const TODAY = new Date(2026, 7, 23);
const TODAY_IDX = dayIndexFromISO("2026-08-23");
const dateIn = (days: number) => isoFromDayIndex(TODAY_IDX + days);

function stream(count: number, mean = 15, sd = 3, everyDays = 14, seed = 9, trend = 0): DiffPoint[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const back = count - 1 - i;
    return {
      d: isoFromDayIndex(TODAY_IDX - back * everyDays),
      v: Math.round((mean + trend * back + nextNormal(rand) * sd) * 10) / 10,
    };
  });
}

const project = (s: DiffPoint[], seedKey = "view") =>
  buildProjection({ stream: s, today: TODAY, sims: 600, seedKey });

describe("readiness", () => {
  it("tells a player with no rounds what to do", () => {
    const r = readiness(project([]));
    expect(r.level).toBe("no_data");
    expect(r.canProject).toBe(false);
    expect(r.detail).toMatch(/first round/i);
  });

  it("counts down the rounds left before an index exists", () => {
    const r = readiness(project(stream(2)));
    expect(r.level).toBe("pre_index");
    expect(r.detail).toMatch(/1 more round\b/);
  });

  it("explains that a short history is about spread, not about data volume", () => {
    const r = readiness(project(stream(5)));
    expect(r.level).toBe("mechanical");
    expect(r.canProject).toBe(false);
    expect(r.detail).toMatch(/how much your scoring varies/);
    // And it points at the surface that DOES work with five rounds.
    expect(r.detail).toMatch(/next round/i);
  });

  it("projects once there is enough", () => {
    expect(readiness(project(stream(30))).canProject).toBe(true);
  });
});

describe("confidenceOf", () => {
  it("flags a dormant player rather than dating from a round they won't play", () => {
    // Last round a year ago.
    const old = stream(30).map((p) => ({
      d: isoFromDayIndex(dayIndexFromISO(p.d) - 400),
      v: p.v,
    }));
    const c = confidenceOf(project(old, "dormant"));
    expect(c.level).toBe("low");
    expect(c.reason).toMatch(/No rounds posted for/);
  });

  it("explains a high-confidence projection with the numbers behind it", () => {
    const c = confidenceOf(project(stream(60, 15, 3, 7), "busy"));
    expect(c.reason).toMatch(/accepted rounds/);
  });
});

describe("goalOutlook", () => {
  const p = project(stream(40, 18, 3, 10, 4, 0.1), "goal");

  it("reports a target already met as reached, with no projection", () => {
    const g = goalOutlook(p, p.currentHi! + 3, dateIn(180), TODAY);
    expect(g.reached).toBe(true);
    expect(g.probability).toBe(1);
    expect(g.note).toMatch(/Already at or below/);
  });

  it("gives a probability and an interval rather than a bare date", () => {
    const g = goalOutlook(p, p.currentHi! - 1, dateIn(365), TODAY);
    expect(g.probability).toBeGreaterThan(0);
    expect(g.probability).toBeLessThanOrEqual(1);
    if (g.medianDateISO) {
      expect(g.earliestISO).not.toBeNull();
      expect(g.earliestISO! <= g.medianDateISO).toBe(true);
    }
  });

  it("says so plainly when a target is out of reach", () => {
    const g = goalOutlook(p, p.currentHi! - 20, dateIn(365), TODAY);
    expect(g.medianDateISO).toBeNull();
    expect(g.note).toMatch(/Not reachable/);
  });

  it("refuses beyond the simulated horizon", () => {
    const g = goalOutlook(p, p.currentHi! - 1, dateIn(HORIZON_DAYS + 100), TODAY);
    expect(g.note).toMatch(/horizon/);
  });

  it("defers to readiness when there are too few rounds", () => {
    const thin = project(stream(5));
    const g = goalOutlook(thin, thin.currentHi! - 2, dateIn(180), TODAY);
    expect(g.probability).toBeNull();
    expect(g.note).toMatch(/scoring varies/);
  });

  it("still reports a target already met, even for a player it cannot project", () => {
    // "You are already there" is an observation about recorded scores, not a
    // forecast, so the data-volume gate must not suppress it.
    const thin = project(stream(5));
    const g = goalOutlook(thin, thin.currentHi! + 2, dateIn(180), TODAY);
    expect(g.reached).toBe(true);
    expect(g.probability).toBe(1);
  });
});

describe("projectedHiOn / realisticFloor", () => {
  const p = project(stream(40), "proj");

  it("returns an ordered range", () => {
    const v = projectedHiOn(p, dateIn(180));
    expect(v.p10!).toBeLessThanOrEqual(v.p50!);
    expect(v.p50!).toBeLessThanOrEqual(v.p90!);
  });

  it("refuses beyond the horizon", () => {
    expect(projectedHiOn(p, dateIn(HORIZON_DAYS + 50)).p50).toBeNull();
  });

  it("gives a floor with a range, not a point", () => {
    const f = realisticFloor(p);
    expect(f.p50).not.toBeNull();
    expect(f.p10!).toBeLessThanOrEqual(f.p90!);
  });

  it("withholds both when the player cannot be projected", () => {
    const thin = project(stream(4));
    expect(projectedHiOn(thin, dateIn(90)).p50).toBeNull();
    expect(realisticFloor(thin).p50).toBeNull();
  });
});

describe("directionOf", () => {
  it("is Holding when the apparent slope is only noise", () => {
    const p = project(stream(40, 15, 3), "flat");
    expect(p.diagnostics.trendApplied).toBe(false);
    expect(directionOf(p)).toBe("Holding");
    expect(trendPerRoundLabel(p)).toBeNull();
  });

  it("is Improving for a genuine downward trend", () => {
    const p = project(stream(60, 12, 1.2, 7, 3, 0.25), "improving");
    expect(p.diagnostics.trendApplied).toBe(true);
    expect(directionOf(p)).toBe("Improving");
    expect(trendPerRoundLabel(p)).toMatch(/^−/);
  });

  it("is null with no rounds at all", () => {
    expect(directionOf(project([]))).toBeNull();
  });
});

describe("formatting", () => {
  it("renders plus handicaps in golf convention", () => {
    expect(hiLabel(12.34)).toBe("HI 12.3");
    expect(hiLabel(-1.2)).toBe("HI +1.2");
    expect(hiValue(-1.2)).toBe("+1.2");
    expect(hiLabel(null)).toBe("—");
  });

  it("keeps the extremes of a percentage honest", () => {
    expect(percentLabel(0.68)).toBe("68%");
    expect(percentLabel(0.001)).toBe("<1%");
    expect(percentLabel(0.999)).toBe(">99%");
    expect(percentLabel(0)).toBe("0%");
    expect(percentLabel(1)).toBe("100%");
    expect(percentLabel(null)).toBe("—");
  });

  it("says durations the way a golfer would", () => {
    expect(horizonLabel(12)).toBe("in 12 days");
    expect(horizonLabel(120)).toBe("in 4 months");
    expect(horizonLabel(900)).toBe("in 2.5 years");
    expect(horizonLabel(0)).toBe("now");
    expect(horizonLabel(null)).toBeNull();
  });
});

describe("clampToHorizon", () => {
  it("keeps a chosen date inside the simulated window", () => {
    expect(clampToHorizon(dateIn(90), TODAY)).toBe(dateIn(90));
    expect(clampToHorizon(dateIn(5000), TODAY)).toBe(dateIn(HORIZON_DAYS));
    expect(clampToHorizon(dateIn(-100), TODAY)).toBe(dateIn(0));
  });
});

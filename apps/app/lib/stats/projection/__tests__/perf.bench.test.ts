import { describe, expect, it } from "vitest";
import { buildProjection, SWEEP_SETTINGS } from "../simulate";
import { mulberry32, nextNormal } from "@/lib/fantasy/simulation/rng";
import { dayIndexFromISO, isoFromDayIndex } from "@/lib/whs/handicapIndex";
import type { DiffPoint } from "@/lib/stats/projectionData";

const TODAY = new Date(2026, 7, 23);
const TODAY_IDX = dayIndexFromISO("2026-08-23");

/** A busy player: 60 rounds, one every 10 days — near the worst case for cost. */
function stream(count = 60, everyDays = 10): DiffPoint[] {
  const rand = mulberry32(3);
  return Array.from({ length: count }, (_, i) => ({
    d: isoFromDayIndex(TODAY_IDX - (count - 1 - i) * everyDays),
    v: Math.round((15 + nextNormal(rand) * 3) * 10) / 10,
  }));
}

/**
 * The projection runs in the browser, once per profile per page load.
 *
 * These bounds are deliberately loose — several times the measured cost on a
 * development machine — because they exist to catch an order-of-magnitude
 * regression (an allocation moved into the inner loop, an accidental O(n²)),
 * not to police milliseconds on whatever hardware CI happens to use. Measured
 * at the time of writing: ~350ms for 2000 sims, ~150ms at the 1000-sim default.
 */
describe("performance", () => {
  it("builds a default projection without blocking the page", () => {
    const s = stream();
    buildProjection({ stream: s, today: TODAY, sims: 200, seedKey: "warm" });

    const t0 = performance.now();
    buildProjection({ stream: s, today: TODAY, seedKey: "perf" });
    const ms = performance.now() - t0;

    expect(ms).toBeLessThan(2500);
  });

  it("sweeps 15 players for compare-all at reduced settings", () => {
    const s = stream();
    buildProjection({ stream: s, today: TODAY, sims: 200, seedKey: "warm" });

    const t0 = performance.now();
    for (let i = 0; i < 15; i++) {
      buildProjection({ stream: s, today: TODAY, ...SWEEP_SETTINGS, seedKey: `sweep-${i}` });
    }
    const ms = performance.now() - t0;

    expect(ms).toBeLessThan(6000);
  });

  it("scales roughly linearly in the simulation count", () => {
    const s = stream();
    buildProjection({ stream: s, today: TODAY, sims: 200, seedKey: "warm" });

    const time = (sims: number) => {
      const t0 = performance.now();
      buildProjection({ stream: s, today: TODAY, sims, seedKey: `n${sims}` });
      return performance.now() - t0;
    };

    const small = Math.max(1, time(500));
    const large = time(2000);
    // 4x the paths must not cost 12x the time — that would mean something in the
    // build is superlinear in the path count.
    expect(large / small).toBeLessThan(12);
  });
});

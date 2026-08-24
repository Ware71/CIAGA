import { describe, expect, it } from "vitest";
import { differentialNeededFor, indexAfterDifferential, nextRoundImpact } from "../nextRound";
import { mulberry32, nextNormal } from "@/lib/fantasy/simulation/rng";
import {
  countingWindow,
  currentIndexTenths,
  dayIndexFromISO,
  fromTenths,
  initWhsState,
  lowestOfNCount,
  windowSize,
  type WhsState,
} from "@/lib/whs/handicapIndex";

const DAY = dayIndexFromISO("2026-08-23");

function stateWith(count: number, mean = 15, sd = 3, seed = 1): WhsState {
  const rand = mulberry32(seed);
  return initWhsState(
    Array.from({ length: count }, (_, i) => ({
      dayIndex: DAY - (count - i) * 10,
      diffTenths: Math.round((mean + nextNormal(rand) * sd) * 10),
    }))
  );
}

describe("indexAfterDifferential", () => {
  it("does not mutate the state it is asked about", () => {
    const s = stateWith(20);
    const before = currentIndexTenths(s);
    const size = windowSize(s);

    indexAfterDifferential(s, DAY, 2.0);
    indexAfterDifferential(s, DAY, 40.0);

    expect(currentIndexTenths(s)).toBe(before);
    expect(windowSize(s)).toBe(size);
  });

  it("is monotone non-decreasing in the posted differential", () => {
    // The index is a mean of the lowest k of the window, so a worse round can
    // never lower it. This is what makes the binary search below exact.
    const s = stateWith(20);
    let prev = -Infinity;
    for (let d = -10; d <= 40; d += 0.5) {
      const hi = indexAfterDifferential(s, DAY, d)!;
      expect(hi).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = hi;
    }
  });

  it("returns null while the player is below the three-round minimum", () => {
    const s = stateWith(1);
    expect(indexAfterDifferential(s, DAY, 15)).toBeNull();
  });

  it("works with only three rounds — the case most society players are in", () => {
    const s = stateWith(2);
    expect(indexAfterDifferential(s, DAY, 15)).not.toBeNull();
  });
});

describe("nextRoundImpact", () => {
  it("brackets the centre and reports deltas against the current index", () => {
    const s = stateWith(20);
    const currentHi = fromTenths(currentIndexTenths(s)!);
    const grid = nextRoundImpact(s, DAY, { centre: 15, spread: 8, currentHi });

    expect(grid.length).toBeGreaterThan(10);
    expect(grid[0].differential).toBeCloseTo(7, 6);
    expect(grid[grid.length - 1].differential).toBeCloseTo(23, 6);

    for (const p of grid) {
      expect(p.handicapIndex).not.toBeNull();
      expect(p.delta).toBeCloseTo(Math.round((p.handicapIndex! - currentHi) * 10) / 10, 6);
    }
  });

  it("agrees with indexAfterDifferential at every point", () => {
    const s = stateWith(16);
    for (const p of nextRoundImpact(s, DAY, { centre: 15, spread: 4 })) {
      expect(p.handicapIndex).toBe(indexAfterDifferential(s, DAY, p.differential));
    }
  });

  it("shows a bad round leaving the index untouched once it misses the counting set", () => {
    const s = stateWith(20, 15, 3);
    const currentHi = fromTenths(currentIndexTenths(s)!);
    const awful = indexAfterDifferential(s, DAY, 45)!;
    // A disaster cannot enter the lowest-k set, so it can only shift the index
    // by displacing whatever aged out.
    expect(Math.abs(awful - currentHi)).toBeLessThan(1.5);
  });
});

describe("differentialNeededFor", () => {
  it("exactly inverts nextRoundImpact across many random states", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = stateWith(12 + (seed % 9), 10 + (seed % 15), 2 + (seed % 4), seed);
      const currentHi = fromTenths(currentIndexTenths(s)!);

      for (const offset of [-1.5, -0.5, 0, 0.4]) {
        const target = Math.round((currentHi + offset) * 10) / 10;
        const needed = differentialNeededFor(s, DAY, target);
        if (needed === null) continue;

        // The answer reaches the target...
        expect(indexAfterDifferential(s, DAY, needed)!).toBeLessThanOrEqual(target + 1e-9);

        // ...and one tenth worse does not, so it really is the threshold. Except
        // at 54.0, where the answer means "any legal round keeps you there" and
        // there is no worse round to test.
        if (needed < 54.0) {
          const worse = indexAfterDifferential(s, DAY, Math.round((needed + 0.1) * 10) / 10)!;
          expect(worse).toBeGreaterThan(target + 1e-9);
        }
      }
    }
  });

  it("returns null when no single round can reach the target", () => {
    const s = stateWith(20, 20, 2);
    const currentHi = fromTenths(currentIndexTenths(s)!);
    // Ten strokes better in one round is not something the best-8-of-20 mean
    // can deliver from a single posting.
    expect(differentialNeededFor(s, DAY, currentHi - 10)).toBeNull();
  });

  it("accepts any round when the target is already met", () => {
    const s = stateWith(20, 15, 3);
    const currentHi = fromTenths(currentIndexTenths(s)!);
    const needed = differentialNeededFor(s, DAY, currentHi + 5)!;
    expect(needed).not.toBeNull();
    expect(needed).toBeGreaterThan(30);
  });
});

describe("countingWindow", () => {
  it("flags exactly the lowest-k differentials", () => {
    const s = stateWith(20);
    const w = countingWindow(s);
    expect(w).toHaveLength(20);

    const counting = w.filter((e) => e.counting);
    expect(counting).toHaveLength(lowestOfNCount(20));

    const worstCounting = Math.max(...counting.map((e) => e.differential));
    const bestNonCounting = Math.min(
      ...w.filter((e) => !e.counting).map((e) => e.differential)
    );
    expect(worstCounting).toBeLessThanOrEqual(bestNonCounting);
  });

  it("tracks how many more rounds until each entry ages out", () => {
    const s = stateWith(20);
    const w = countingWindow(s);
    expect(w[0].roundsUntilDropOut).toBe(1); // oldest goes on the next posting
    expect(w[w.length - 1].roundsUntilDropOut).toBe(20); // newest survives 20 more
  });

  it("is empty for a player with no rounds", () => {
    expect(countingWindow(initWhsState([]))).toEqual([]);
  });
});

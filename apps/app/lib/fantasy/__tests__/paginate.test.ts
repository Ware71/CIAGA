import { describe, expect, it, vi } from "vitest";
import { POSTGREST_PAGE_SIZE, readAllPages } from "@/lib/fantasy/paginate";

/**
 * PostgREST truncates at 1000 rows without saying so. The cash-out estimators
 * read fantasy_odds_snapshots through this helper because the unpaginated read
 * silently blanked every estimate once a board got big enough — 777 active rows
 * already come back for a 120-market event, and The International carries 236.
 */
describe("readAllPages", () => {
  /** A fake table that honours range() over a fixed, totally-ordered row set. */
  const table = (rows: number[]) => {
    const ranges: [number, number][] = [];
    const build = () => ({
      range: (from: number, to: number) => {
        ranges.push([from, to]);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
    });
    return { build, ranges };
  };

  it("returns a single short page without asking for a second", async () => {
    const t = table([1, 2, 3]);
    expect(await readAllPages(t.build)).toEqual([1, 2, 3]);
    expect(t.ranges).toEqual([[0, POSTGREST_PAGE_SIZE - 1]]);
  });

  it("reads every row across a >1000-row boundary, in order and without gaps", async () => {
    const all = Array.from({ length: POSTGREST_PAGE_SIZE * 2 + 37 }, (_, i) => i);
    const t = table(all);
    expect(await readAllPages(t.build)).toEqual(all);
    expect(t.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after an exactly-full final page rather than looping", async () => {
    const all = Array.from({ length: POSTGREST_PAGE_SIZE }, (_, i) => i);
    const t = table(all);
    expect(await readAllPages(t.build)).toEqual(all);
    // A full page is indistinguishable from "more may follow", so it must probe
    // once more and get an empty page — never assume the read is done.
    expect(t.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("builds a fresh query per page — PostgREST builders are single-use", async () => {
    const all = Array.from({ length: POSTGREST_PAGE_SIZE + 1 }, (_, i) => i);
    const build = vi.fn(() => ({
      range: (from: number, to: number) =>
        Promise.resolve({ data: all.slice(from, to + 1), error: null }),
    }));
    await readAllPages(build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("throws the query error instead of silently returning a partial read", async () => {
    const build = () => ({
      range: () => Promise.resolve({ data: null, error: new Error("boom") }),
    });
    await expect(readAllPages(build)).rejects.toThrow("boom");
  });
});

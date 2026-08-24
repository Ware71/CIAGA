import { describe, expect, it } from "vitest";
import { POSTGREST_PAGE_SIZE } from "@/lib/fantasy/paginate";
import { readActiveSnapshots, readEventMarkets, type QueryRoot } from "@/lib/fantasy/eventReads";

/**
 * REGRESSION: the board read snapshots with its own `range()` loop and NO
 * ordering. `range()` over an unordered select has no defined row-to-page
 * assignment, so once The International 2026 passed 1000 active snapshots
 * (it carries 1,265) a page boundary could drop rows — and because
 * writeSnapshots inserts a market's selections contiguously, it dropped a whole
 * market at a time. That market then had no selections, `marketsInTab` removed
 * it, and the board rendered the wrong book under its label: birdie odds shown
 * as "Bogey or worse", with a bogey click placing a birdie bet.
 *
 * The order MUST be on `id` (the primary key). `event_version` and
 * `computed_at` repeat across a whole snapshot generation, so ordering by
 * either leaves boundaries just as undefined.
 */
describe("event reads are paged AND totally ordered", () => {
  /**
   * Records the query chain, and honours range() over a fixed row set.
   * `readAllPages` builds a fresh query per page (PostgREST builders are
   * single-use), so the filters are recorded per build and `calls` reports the
   * most recent one; `ranges` accumulates across every page.
   */
  function fakeDb(rows: unknown[]) {
    const calls: {
      table?: string; columns?: string; order?: string;
      eq: [string, unknown][]; ranges: [number, number][]; builds: number;
    } = { eq: [], ranges: [], builds: 0 };
    const db: QueryRoot = {
      from(table: string) {
        calls.table = table;
        calls.eq = [];
        calls.builds += 1;
        const builder = {
          select(columns: string) { calls.columns = columns; return this; },
          eq(col: string, val: unknown) { calls.eq.push([col, val]); return this; },
          order(col: string) { calls.order = col; return this; },
          range(from: number, to: number) {
            calls.ranges.push([from, to]);
            return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
          },
        };
        return builder;
      },
    };
    return { db, calls };
  }

  it("orders snapshots by the primary key, not by event_version or computed_at", async () => {
    const { db, calls } = fakeDb([{ id: "a" }]);
    await readActiveSnapshots("evt", "id, market_id", db);
    expect(calls.order).toBe("id");
  });

  it("filters snapshots to the event's ACTIVE rows", async () => {
    const { db, calls } = fakeDb([{ id: "a" }]);
    await readActiveSnapshots("evt", "id, market_id", db);
    expect(calls.table).toBe("fantasy_odds_snapshots");
    expect(calls.eq).toEqual([
      ["event_id", "evt"],
      ["status", "active"],
    ]);
  });

  it("reads EVERY snapshot past the 1000-row cap — the International case", async () => {
    // 1,265 active rows: the exact shape that broke the board.
    const rows = Array.from({ length: 1265 }, (_, i) => ({ id: `s${i}` }));
    const { db, calls } = fakeDb(rows);
    const got = await readActiveSnapshots<{ id: string }>("evt", "id", db);
    expect(got).toHaveLength(1265);
    expect(got).toEqual(rows);
    expect(calls.ranges).toEqual([
      [0, POSTGREST_PAGE_SIZE - 1],
      [POSTGREST_PAGE_SIZE, POSTGREST_PAGE_SIZE * 2 - 1],
    ]);
  });

  it("orders and pages markets the same way", async () => {
    const rows = Array.from({ length: POSTGREST_PAGE_SIZE + 5 }, (_, i) => ({ id: `m${i}` }));
    const { db, calls } = fakeDb(rows);
    const got = await readEventMarkets<{ id: string }>("evt", "*", db);
    expect(calls.table).toBe("fantasy_markets");
    expect(calls.order).toBe("id");
    expect(calls.eq).toEqual([["event_id", "evt"]]);
    expect(got).toHaveLength(POSTGREST_PAGE_SIZE + 5);
    // A fresh query per page — PostgREST builders are single-use.
    expect(calls.builds).toBe(2);
  });
});

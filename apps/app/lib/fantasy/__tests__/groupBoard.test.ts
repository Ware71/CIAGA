import { describe, expect, it } from "vitest";
import {
  buildCountTable,
  buildFinishesTable,
  buildRareRows,
  deriveTabs,
  marketsInTab,
  roundOf,
  sortExactFinish,
  sortHoles,
  type BoardMarket,
  type Selection,
} from "@/lib/fantasy/board/groupBoard";

let seq = 0;
function sel(key: string, probability: number, label = key): Selection {
  seq += 1;
  return { key, label, probability, decimal_odds: +(1 / probability).toFixed(2), snapshot_id: `s${seq}`, event_version: 1 };
}
function market(partial: Partial<BoardMarket> & { market_type: string }): BoardMarket {
  seq += 1;
  return {
    id: `m${seq}`,
    group: "",
    display_name: partial.market_type,
    status: "open",
    params: {},
    subject_profile_id: null,
    opponent_profile_id: null,
    selections: [],
    ...partial,
  };
}

describe("roundOf", () => {
  it("reads a positive integer round, else null", () => {
    expect(roundOf({ params: { round: 2 } })).toBe(2);
    expect(roundOf({ params: {} })).toBeNull();
    expect(roundOf({ params: { round: 0 } })).toBeNull();
    expect(roundOf({ params: { round: 1.5 } })).toBeNull();
  });
});

describe("deriveTabs", () => {
  it("returns only the Event tab when nothing is round-scoped", () => {
    const tabs = deriveTabs([market({ market_type: "outright_winner", selections: [sel("a", 0.5)] })]);
    expect(tabs.map((t) => t.id)).toEqual(["event"]);
  });

  it("adds a sorted tab per round that has priced markets", () => {
    const markets = [
      market({ market_type: "outright_winner", params: { round: 2 }, selections: [sel("a", 0.5)] }),
      market({ market_type: "outright_winner", params: { round: 1 }, selections: [sel("a", 0.5)] }),
      // Round 3 present but with no priced selection → excluded.
      market({ market_type: "outright_winner", params: { round: 3 }, selections: [] }),
    ];
    expect(deriveTabs(markets).map((t) => t.label)).toEqual(["Event", "Round 1", "Round 2"]);
  });
});

describe("marketsInTab", () => {
  it("splits event-wide from round markets and drops empty ones", () => {
    const ev = market({ market_type: "outright_winner", selections: [sel("a", 0.5)] });
    const r1 = market({ market_type: "outright_winner", params: { round: 1 }, selections: [sel("a", 0.5)] });
    const empty = market({ market_type: "top_n", selections: [] });
    const all = [ev, r1, empty];
    expect(marketsInTab(all, null)).toEqual([ev]);
    expect(marketsInTab(all, 1)).toEqual([r1]);
  });
});

describe("buildFinishesTable", () => {
  it("builds To Win + Top N columns with players as rows, sorted by win prob", () => {
    const winner = market({
      market_type: "outright_winner",
      selections: [sel("p1", 0.2, "Alice"), sel("p2", 0.5, "Bob"), sel("p3", 0.3, "Cara")],
    });
    const top3 = market({
      market_type: "top_n",
      params: { n: 3 },
      selections: [sel("p1", 0.6, "Alice"), sel("p2", 0.8, "Bob")],
    });
    const table = buildFinishesTable([top3, winner])!;
    expect(table.columns.map((c) => c.label)).toEqual(["To Win", "Top 3"]);
    // Bob (0.5) ranks above Cara (0.3) above Alice (0.2).
    expect(table.rows.map((r) => r.name)).toEqual(["Bob", "Cara", "Alice"]);
    // Cara has no Top 3 selection → blank cell.
    const cara = table.rows.find((r) => r.name === "Cara")!;
    expect(cara.cells[0]?.selection.key).toBe("p3");
    expect(cara.cells[1]).toBeNull();
  });

  it("returns null when there are no finish markets", () => {
    expect(buildFinishesTable([market({ market_type: "birdies", selections: [sel("yes", 0.4)] })])).toBeNull();
  });

  it("ignores round-scoped winner markets", () => {
    const roundWinner = market({
      market_type: "outright_winner",
      params: { round: 1 },
      selections: [sel("p1", 0.5, "Alice")],
    });
    expect(buildFinishesTable([roundWinner])).toBeNull();
  });
});

describe("buildCountTable", () => {
  const names = { p1: "Alice", p2: "Bob" };
  function birdie(pid: string, count: number, prob: number): BoardMarket {
    return market({
      market_type: "birdies",
      subject_profile_id: pid,
      params: { count },
      selections: [sel("yes", prob, "Yes")],
    });
  }

  it("lays out distinct counts as columns and players as rows", () => {
    const markets = [birdie("p1", 1, 0.7), birdie("p1", 2, 0.4), birdie("p2", 1, 0.9), birdie("p2", 2, 0.6)];
    const table = buildCountTable(markets, names, "birdies", null, (c) => `${c}+`)!;
    expect(table.columns.map((c) => c.label)).toEqual(["1+", "2+"]);
    // Bob's 1+ (0.9) outranks Alice's (0.7).
    expect(table.rows.map((r) => r.name)).toEqual(["Bob", "Alice"]);
    expect(table.rows[0].cells[1]?.selection.probability).toBe(0.6);
  });

  it("leaves a blank cell when a player lacks a count", () => {
    const markets = [birdie("p1", 1, 0.7), birdie("p2", 1, 0.9), birdie("p2", 2, 0.6)];
    const table = buildCountTable(markets, names, "birdies", null, (c) => `${c}+`)!;
    const alice = table.rows.find((r) => r.name === "Alice")!;
    expect(alice.cells[1]).toBeNull();
  });

  it("respects the round filter", () => {
    const evt = birdie("p1", 1, 0.7);
    const rnd = market({
      market_type: "birdies",
      subject_profile_id: "p1",
      params: { count: 1, round: 2 },
      selections: [sel("yes", 0.3, "Yes")],
    });
    expect(buildCountTable([evt, rnd], names, "birdies", null, (c) => `${c}+`)!.rows[0].cells[0]!.selection.probability).toBe(0.7);
    expect(buildCountTable([evt, rnd], names, "birdies", 2, (c) => `${c}+`)!.rows[0].cells[0]!.selection.probability).toBe(0.3);
  });
});

describe("buildRareRows", () => {
  it("returns one row per field special with its yes selection", () => {
    const hio = market({ market_type: "field_special", params: { kind: "hio" }, display_name: "A hole-in-one", selections: [sel("yes", 0.05)] });
    const alb = market({ market_type: "field_special", params: { kind: "albatross" }, display_name: "An albatross", selections: [sel("yes", 0.01)] });
    const rows = buildRareRows([hio, alb, market({ market_type: "birdies", selections: [sel("yes", 0.4)] })]);
    expect(rows.map((r) => r.market.display_name)).toEqual(["A hole-in-one", "An albatross"]);
    expect(rows[0].selection.key).toBe("yes");
  });
});

describe("selection ordering", () => {
  it("sorts exact-finish selections by numeric position, not odds", () => {
    const selections = [sel("3", 0.4), sel("1", 0.1), sel("2", 0.5)];
    expect(sortExactFinish(selections).map((s) => s.key)).toEqual(["1", "2", "3"]);
  });

  it("sorts hole selections by round then hole, not odds", () => {
    const selections = [sel("r2_h1", 0.2), sel("r1_h9", 0.9), sel("r1_h1", 0.5)];
    expect(sortHoles(selections).map((s) => s.key)).toEqual(["r1_h1", "r1_h9", "r2_h1"]);
  });
});

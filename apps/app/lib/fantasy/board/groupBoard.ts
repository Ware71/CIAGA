/**
 * Pure view-model helpers for the event market board. They turn the flat
 * `BoardMarket[]` the odds route returns into the tab / table / collapsible
 * structures the UI renders. Kept free of React so they can be unit-tested and
 * shared between the Event and Round tabs.
 *
 * Grouping is driven by `market_type` + `params` (round / n / count / kind /
 * outcome), NOT by the server's `def.group` — the board's own taxonomy is
 * richer than the seven generic sections.
 */

export type Selection = {
  key: string;
  label: string;
  probability: number;
  decimal_odds: number;
  snapshot_id: string;
  event_version: number;
};

export type BoardMarket = {
  id: string;
  market_type: string;
  group: string;
  display_name: string;
  status: string;
  params: Record<string, unknown>;
  subject_profile_id: string | null;
  opponent_profile_id: string | null;
  selections: Selection[];
};

/** A table cell: the market to toggle and the player's selection within it. */
export type Cell = { market: BoardMarket; selection: Selection } | null;
export type TableColumn = { id: string; label: string };
export type TableRow = { profileId: string; name: string; cells: Cell[] };
export type MarketTableModel = { columns: TableColumn[]; rows: TableRow[] };

export type BoardTab = { id: string; label: string; round: number | null };

/** params.round as a positive int, else null (event-wide). Mirrors roundUtil. */
export function roundOf(m: Pick<BoardMarket, "params">): number | null {
  const r = Number((m.params as { round?: unknown }).round);
  return Number.isInteger(r) && r > 0 ? r : null;
}

export function topNof(m: Pick<BoardMarket, "params">): number {
  const n = Number((m.params as { n?: unknown }).n);
  return Number.isInteger(n) && n > 0 ? n : 3;
}

export function countOf(m: Pick<BoardMarket, "params">): number {
  const c = Number((m.params as { count?: unknown }).count);
  return Number.isInteger(c) && c > 0 ? c : 1;
}

/** Markets with at least one priced selection belonging to the given round. */
export function marketsInTab(markets: BoardMarket[], round: number | null): BoardMarket[] {
  return markets.filter((m) => roundOf(m) === round && m.selections.length > 0);
}

/** Event tab + one tab per round that actually has priced markets. */
export function deriveTabs(markets: BoardMarket[]): BoardTab[] {
  const rounds = new Set<number>();
  for (const m of markets) {
    const r = roundOf(m);
    if (r != null && m.selections.length > 0) rounds.add(r);
  }
  const tabs: BoardTab[] = [{ id: "event", label: "Event", round: null }];
  for (const r of [...rounds].sort((a, b) => a - b)) {
    tabs.push({ id: `round-${r}`, label: `Round ${r}`, round: r });
  }
  return tabs;
}

/** Union player table over a set of single-market columns keyed by profileId. */
function playerTable(columns: { column: TableColumn; market: BoardMarket }[]): MarketTableModel {
  const name = new Map<string, string>();
  const order: string[] = [];
  const byPlayer = columns.map(({ market }) => {
    const map = new Map<string, Selection>();
    for (const sel of market.selections) {
      map.set(sel.key, sel);
      if (!name.has(sel.key)) {
        name.set(sel.key, sel.label);
        order.push(sel.key);
      }
    }
    return map;
  });
  const rows: TableRow[] = order.map((pid) => ({
    profileId: pid,
    name: name.get(pid) ?? "Player",
    cells: columns.map(({ market }, i) => {
      const sel = byPlayer[i].get(pid);
      return sel ? { market, selection: sel } : null;
    }),
  }));
  rows.sort((a, b) => rowSortKey(b) - rowSortKey(a));
  return { columns: columns.map((c) => c.column), rows };
}

/** Rank rows by the first column's probability, falling back to the best cell. */
function rowSortKey(row: TableRow): number {
  if (row.cells[0]) return row.cells[0].selection.probability;
  let best = 0;
  for (const c of row.cells) if (c) best = Math.max(best, c.selection.probability);
  return best;
}

/**
 * Finishes matrix — To Win (outright) + Top N columns, players as rows.
 * Event-wide only (Top N has no round variant); null when neither exists.
 */
export function buildFinishesTable(markets: BoardMarket[]): MarketTableModel | null {
  const cols: { column: TableColumn; market: BoardMarket }[] = [];
  const winner = markets.find((m) => m.market_type === "outright_winner" && roundOf(m) == null);
  if (winner) cols.push({ column: { id: winner.id, label: "To Win" }, market: winner });
  const topN = markets
    .filter((m) => m.market_type === "top_n" && roundOf(m) == null)
    .sort((a, b) => topNof(a) - topNof(b));
  for (const m of topN) cols.push({ column: { id: m.id, label: `Top ${topNof(m)}` }, market: m });
  if (cols.length === 0) return null;
  return playerTable(cols);
}

/**
 * Per-player count matrix (birdies / eagles). Each (player, count) is its own
 * back-only market with a single "yes" selection; columns are the distinct
 * counts. `columnLabel` renders the header (e.g. "2+"). Null when none exist.
 */
export function buildCountTable(
  markets: BoardMarket[],
  names: Record<string, string>,
  type: string,
  round: number | null,
  columnLabel: (count: number) => string
): MarketTableModel | null {
  const ms = markets.filter(
    (m) => m.market_type === type && roundOf(m) === round && m.subject_profile_id
  );
  if (ms.length === 0) return null;

  const counts = [...new Set(ms.map(countOf))].sort((a, b) => a - b);
  const columns: TableColumn[] = counts.map((c) => ({ id: `c${c}`, label: columnLabel(c) }));

  // (playerId, count) → market. Player order by first appearance.
  const order: string[] = [];
  const byKey = new Map<string, BoardMarket>();
  for (const m of ms) {
    const pid = m.subject_profile_id as string;
    if (!order.includes(pid)) order.push(pid);
    byKey.set(`${pid}|${countOf(m)}`, m);
  }

  const rows: TableRow[] = order.map((pid) => ({
    profileId: pid,
    name: names[pid] ?? "Player",
    cells: counts.map((c) => {
      const market = byKey.get(`${pid}|${c}`);
      const sel = market?.selections.find((s) => s.key === "yes") ?? market?.selections[0];
      return market && sel ? { market, selection: sel } : null;
    }),
  }));
  rows.sort((a, b) => rowSortKey(b) - rowSortKey(a));
  return { columns, rows };
}

/** Field-wide rare specials (HIO / albatross / any eagle) as single-odds rows. */
export function buildRareRows(
  markets: BoardMarket[]
): { market: BoardMarket; selection: Selection }[] {
  return markets
    .filter((m) => m.market_type === "field_special")
    .map((m) => {
      const selection = m.selections.find((s) => s.key === "yes") ?? m.selections[0];
      return selection ? { market: m, selection } : null;
    })
    .filter((r): r is { market: BoardMarket; selection: Selection } => r != null);
}

/** Exact-finish selections in position order (1st → Nth), not by odds. */
export function sortExactFinish(selections: Selection[]): Selection[] {
  return [...selections].sort((a, b) => Number(a.key) - Number(b.key));
}

/** Hole selections in play order (round then hole number), not by odds. */
export function sortHoles(selections: Selection[]): Selection[] {
  return [...selections].sort((a, b) => holeOrder(a.key) - holeOrder(b.key));
}

function holeOrder(key: string): number {
  const m = /^r(\d+)_h(\d+)$/.exec(key);
  if (!m) return 0;
  return Number(m[1]) * 100 + Number(m[2]);
}

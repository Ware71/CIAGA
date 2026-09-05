"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { supabase } from "@/lib/supabaseClient";
import { safeJson } from "@/lib/fantasy/safeJson";
import { marketAllowsMultiple, subjectKeysFor } from "@/lib/fantasy/parlayRules";
import { findSelfRestriction } from "@/lib/fantasy/selfRestriction";
import { useSlip } from "@/lib/fantasy/slipStore";
import {
  buildCountTable,
  buildFinishesTable,
  buildMatchRows,
  buildRareRows,
  buildScoreBandTable,
  buildScoreTotalTable,
  deriveTabs,
  marketsInTab,
  sortExactFinish,
  sortHoles,
  type BoardMarket,
  type Cell,
  type Selection,
} from "@/lib/fantasy/board/groupBoard";
import { BetSlip } from "@/components/fantasy/BetSlip";
import { OddsFormatMenu } from "@/components/fantasy/OddsValue";
import { OddsBlank, OddsButton } from "@/components/fantasy/board/OddsButton";
import { MarketTable } from "@/components/fantasy/board/MarketTable";
import { PlayerAccordion } from "@/components/fantasy/board/PlayerAccordion";
import { SeasonMarketsPanel } from "@/components/fantasy/SeasonMarketsPanel";
import { PlayerStatsSheet, type PlayerStats } from "@/components/fantasy/PlayerStatsSheet";

type BoardResponse = {
  generated: boolean;
  event: {
    id: string;
    name: string;
    status: string;
    group_id: string;
    course_id: string | null;
    ranking_basis?: "gross" | "net" | "stableford";
  };
  state?: {
    version: number;
    odds_stale: boolean;
    last_refreshed_at: string | null;
    is_final: boolean;
    narrative?: string | null;
  };
  refreshing?: boolean;
  markets?: BoardMarket[];
  names?: Record<string, string>;
  players?: Record<string, PlayerStats>;
  canGenerate?: boolean;
  error?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLASH_MS = 1400;
/** How old the board must be before returning to the tab refetches it. */
const BOARD_STALE_MS = 30_000;
const SEASON_TAB = "season";

type HoleOutcome = "birdie_or_better" | "bogey_or_worse";

const HOLE_OUTCOMES: { id: HoleOutcome; label: string }[] = [
  { id: "birdie_or_better", label: "Birdie or better" },
  { id: "bogey_or_worse", label: "Bogey or worse" },
];

type CategoryId =
  | "finishes" | "match" | "scoreBands" | "scoreTotals" | "birdies" | "eagles" | "rare" | "holes";

const CATEGORY_TABS: { id: CategoryId; label: string }[] = [
  { id: "finishes", label: "Finishes" },
  { id: "match", label: "Match Bets" },
  { id: "scoreBands", label: "Score Bands" },
  { id: "scoreTotals", label: "Score Totals" },
  { id: "birdies", label: "Birdies" },
  { id: "eagles", label: "Eagles" },
  { id: "rare", label: "Rare Events" },
  { id: "holes", label: "Hole Specials" },
];

export default function EventMarketsClient({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  // Admin "Refresh": rebuild every field profile then force-reprice this event.
  const [refreshingMarkets, setRefreshingMarkets] = useState(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the board last came back, so returning to the tab doesn't re-pull it.
  const lastBoardFetchRef = useRef<number>(0);
  // Tabs: "event" | "round-N" | "season".
  const [activeTab, setActiveTab] = useState<string>("event");
  const [seasonId, setSeasonId] = useState<string | null>(null);
  // Category tabs within the Event/Round board (Finishes, Match Bets, ...).
  const [activeCategory, setActiveCategory] = useState<CategoryId>("finishes");
  // Shared gross/net toggle for Match Bets, Score Bands, Score Totals.
  const [scoreBasis, setScoreBasis] = useState<"gross" | "net">("gross");
  // Collapsibles: exact-finish/score-totals keyed by market id, hole specials keyed by player.
  const [openExact, setOpenExact] = useState<Set<string>>(new Set());
  const [openTotals, setOpenTotals] = useState<Set<string>>(new Set());
  const [openHole, setOpenHole] = useState<Set<string>>(new Set());
  const [holeOutcome, setHoleOutcome] = useState<Map<string, HoleOutcome>>(new Map());
  // Price movement flashes: `${marketId}|${selectionKey}` → up/down.
  const prevOdds = useRef<Map<string, number>>(new Map());
  const [flashes, setFlashes] = useState<Map<string, "up" | "down">>(new Map());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Player stats sheet
  const [statsFor, setStatsFor] = useState<{ profileId: string; name: string } | null>(null);
  // Bet slip (multi-selection, shared across event pages)
  const slip = useSlip();
  const [balance, setBalance] = useState<number | null>(null);
  // Who's looking — self-betting restrictions grey out selections against
  // yourself (placement enforces the same rule server-side).
  const [viewerProfileId, setViewerProfileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getViewerSession().then((session) => {
      if (!cancelled && session) setViewerProfileId(session.profileId);
    });
    return () => { cancelled = true; };
  }, []);

  const fetchBalance = useCallback(async (groupId: string) => {
    const session = await requireViewerSession();
    if (!session) return;
    const res = await fetch(`/api/fantasy/groups/${groupId}/wallet?event_id=${eventId}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) {
      const j = await res.json();
      setBalance(j.summary?.balance ?? null);
    }
  }, [eventId]);

  const fetchBoard = useCallback(async () => {
    const session = await requireViewerSession();
    if (!session) return;
    const res = await fetch(`/api/fantasy/events/${eventId}/odds`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const j = (await safeJson(res)) as BoardResponse;
    // Stamped on any completed response, success or not: a failing board should
    // not be retried on every tab focus either.
    lastBoardFetchRef.current = Date.now();
    if (res.ok) {
      // Diff odds against the previous board for the up/down flash.
      const moved = new Map<string, "up" | "down">();
      for (const m of j.markets ?? []) {
        for (const s of m.selections) {
          const key = `${m.id}|${s.key}`;
          const prev = prevOdds.current.get(key);
          if (prev != null && prev !== s.decimal_odds) {
            moved.set(key, s.decimal_odds > prev ? "up" : "down");
          }
          prevOdds.current.set(key, s.decimal_odds);
        }
      }
      if (moved.size > 0) {
        setFlashes(moved);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashes(new Map()), FLASH_MS);
      }
      setBoard(j);
    } else {
      setBoard((prev) => prev ?? ({ generated: false, error: j.error } as BoardResponse));
    }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchBoard();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchBoard]);

  useEffect(() => {
    if (board?.generated && board.event?.group_id) fetchBalance(board.event.group_id);
  }, [board?.generated, board?.event?.group_id, fetchBalance]);

  // Discover the group's season board (if any) for the Season tab.
  useEffect(() => {
    const groupId = board?.event?.group_id;
    if (!board?.generated || !groupId) return;
    let cancelled = false;
    (async () => {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/groups/${groupId}/season`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }).catch(() => null);
      if (!res || !res.ok || cancelled) return;
      const j = await res.json().catch(() => null);
      if (!cancelled && j?.headline?.seasonId) setSeasonId(j.headline.seasonId as string);
    })();
    return () => { cancelled = true; };
  }, [board?.generated, board?.event?.group_id]);

  // Realtime: refetch when the event's fantasy state flips.
  useEffect(() => {
    const channel = supabase
      .channel(`fantasy-event-state:${eventId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fantasy_event_state", filter: `event_id=eq.${eventId}` },
        () => {
          if (refetchTimer.current) clearTimeout(refetchTimer.current);
          refetchTimer.current = setTimeout(() => { fetchBoard(); }, 400);
        }
      )
      .subscribe();
    // Only worth a request if the board has actually gone stale.
    //
    // GET /odds is no-store, reads ~1,265 snapshot rows over two-plus paginated
    // round trips, and when the odds are stale and the event isn't final it can
    // run the Monte Carlo sim inline (odds/route.ts, hence maxDuration 60).
    // Unconditional, that was the full cost every time you tabbed back — and the
    // realtime channel above already covers genuine state changes, so this only
    // needs to catch a long absence.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastBoardFetchRef.current < BOARD_STALE_MS) return;
      fetchBoard();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [eventId, fetchBoard]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/events/${eventId}/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const j = await safeJson(res);
      if (!res.ok) {
        setGenerateError(j.error ?? "Failed to generate markets");
        return;
      }
      await fetchBoard();
    } finally {
      setGenerating(false);
    }
  };

  // Admin refresh: rebuild all field profiles (picks up newly-acceptable rounds)
  // then force a fresh re-price. Backed by the owner/admin-gated route.
  const handleRefreshMarkets = async () => {
    if (refreshingMarkets) return;
    setRefreshingMarkets(true);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/events/${eventId}/rebuild-profiles`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      await safeJson(res);
      await fetchBoard();
    } finally {
      setRefreshingMarkets(false);
    }
  };

  // Why the viewer may not back a selection (betting against themselves), or
  // null when it's fine. Mirrored server-side at placement.
  const selfRestriction = (market: BoardMarket, selectionKey: string): string | null =>
    findSelfRestriction(
      viewerProfileId,
      {
        market_type: market.market_type,
        subject_profile_id: market.subject_profile_id,
        opponent_profile_id: market.opponent_profile_id,
        params: market.params,
      },
      selectionKey
    );

  const toggleSelection = (market: BoardMarket, selection: Selection) => {
    if (!board?.event) return;
    if (selfRestriction(market, selection.key)) return;
    slip.toggle({
      marketId: market.id,
      selectionKey: selection.key,
      snapshotId: selection.snapshot_id,
      decimalOdds: selection.decimal_odds,
      eventId: board.event.id,
      eventName: board.event.name,
      groupId: board.event.group_id,
      marketLabel: market.display_name,
      selectionLabel: selection.label,
      subjectKeys: subjectKeysFor(
        {
          market_type: market.market_type,
          subject_profile_id: market.subject_profile_id,
          opponent_profile_id: market.opponent_profile_id,
        },
        selection.key
      ),
      marketType: market.market_type,
      params: market.params,
      coOccurrable: marketAllowsMultiple({ market_type: market.market_type, params: market.params }),
      subjectProfileId: market.subject_profile_id,
      opponentProfileId: market.opponent_profile_id,
      eventRankingBasis: board.event.ranking_basis,
    });
  };

  const openStats = (profileId: string) => {
    setStatsFor({ profileId, name: board?.names?.[profileId] ?? "Player" });
  };

  const stale = !!board?.state?.odds_stale;
  const boardLocked = !!board?.state?.is_final || board?.event?.status === "completed";
  const markets = useMemo(() => board?.markets ?? [], [board?.markets]);
  const names = board?.names ?? {};

  const tabs = useMemo(() => {
    const base = deriveTabs(markets);
    return seasonId ? [...base, { id: SEASON_TAB, label: "Season", round: null }] : base;
  }, [markets, seasonId]);

  // Keep the active tab valid as markets load / change.
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTab)) setActiveTab("event");
  }, [tabs, activeTab]);

  const activeRound = useMemo(
    () => tabs.find((t) => t.id === activeTab)?.round ?? null,
    [tabs, activeTab]
  );

  // ---- shared row / cell renderers (close over slip / flash / lock state) ----

  const renderCell = (cell: Cell) => {
    if (!cell) return <OddsBlank />;
    // Interpolated ladder-gap filler: indicative price, never bettable.
    if (cell.placeholder) {
      return (
        <OddsButton
          odds={cell.selection.decimal_odds}
          inSlip={false}
          canBack={false}
          stale={false}
          onClick={() => {}}
          title="Indicative price — no market currently open at this line"
        />
      );
    }
    const { market, selection } = cell;
    const restricted = selfRestriction(market, selection.key);
    return (
      <OddsButton
        odds={selection.decimal_odds}
        inSlip={slip.has(market.id, selection.key)}
        canBack={!stale && !boardLocked && market.status === "open" && !restricted}
        stale={stale}
        flash={flashes.get(`${market.id}|${selection.key}`)}
        onClick={() => toggleSelection(market, selection)}
        title={restricted ?? undefined}
      />
    );
  };

  // Score-band cells also show the player-relative numeric range (band
  // boundaries differ per player, so the column header alone isn't enough).
  const renderBandCell = (cell: Cell) => {
    if (!cell) return <OddsBlank />;
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[8px] text-[color:var(--sec-muted)] whitespace-nowrap">{cell.selection.label}</span>
        {renderCell(cell)}
      </div>
    );
  };

  const selectionRow = (market: BoardMarket, sel: Selection) => {
    const isPlayerKey = UUID_RE.test(sel.key);
    return (
      <div
        key={sel.key}
        className="flex items-center justify-between py-1 border-b border-[color:var(--sec-hair)] last:border-b-0"
      >
        <span className="flex min-w-0 items-center gap-1 pr-2">
          <span className="text-[12px] text-[color:var(--sec-muted)] truncate">{sel.label}</span>
          {isPlayerKey && (
            <button
              type="button"
              aria-label={`About ${sel.label}`}
              onClick={() => openStats(sel.key)}
              className="shrink-0 text-[color:var(--sec-muted)] hover:text-[color:var(--sec-muted)]"
            >
              <Info className="h-3 w-3" />
            </button>
          )}
        </span>
        {renderCell({ market, selection: sel })}
      </div>
    );
  };

  // A single market card (round winner, finish ranges, match bets, scoring).
  const marketCard = (market: BoardMarket, selections: Selection[]) => (
    <div
      key={market.id}
      className={`rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] px-3 py-2.5 ${market.status === "suspended" ? "opacity-50" : ""}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <button
          type="button"
          disabled={!market.subject_profile_id}
          onClick={() => market.subject_profile_id && openStats(market.subject_profile_id)}
          className="flex items-center gap-1 text-[12px] font-semibold text-[color:var(--sec-text)] disabled:cursor-default min-w-0"
        >
          <span className="truncate">{market.display_name}</span>
          {market.subject_profile_id && <Info className="h-3 w-3 shrink-0 text-[color:var(--sec-muted)]" />}
        </button>
        {market.status === "suspended" && (
          <span className="text-[9px] text-amber-300/70 uppercase tracking-wider">Suspended</span>
        )}
      </div>
      <div className="space-y-1">{selections.map((sel) => selectionRow(market, sel))}</div>
    </div>
  );

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const basisOf = (m: BoardMarket): "gross" | "net" =>
    (m.params as { basis?: unknown }).basis === "net" ? "net" : "gross";

  const noMarkets = (round: number | null) => (
    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_80%,transparent)] px-4 py-6 text-center text-sm text-[color:var(--sec-muted)]">
      No open markets in this category{round != null ? " for this round" : ""}.
    </div>
  );

  const basisToggle = (
    <div className="mb-2 inline-flex rounded-lg border border-[color:var(--sec-hair)] p-0.5 text-[10px]">
      {(["gross", "net"] as const).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => setScoreBasis(b)}
          className={`rounded-md px-3 py-1 font-semibold capitalize transition-colors ${
            scoreBasis === b ? "bg-[color:var(--sec-surface-2)] text-[color:var(--sec-accent)]" : "text-[color:var(--sec-muted)]"
          }`}
        >
          {b}
        </button>
      ))}
    </div>
  );

  // ---- per-tab market data (grouped by category, driven by market_type + params) ----

  const boardData = (round: number | null) => {
    const tabMarkets = marketsInTab(markets, round);
    return {
      finishes: round == null ? buildFinishesTable(tabMarkets) : null,
      roundWinner: round != null ? tabMarkets.filter((m) => m.market_type === "outright_winner") : [],
      exact: tabMarkets.filter((m) => m.market_type === "finish_position"),
      ranges: tabMarkets.filter((m) => m.market_type === "finish_range"),
      h2h: tabMarkets.filter((m) => m.market_type === "h2h" && basisOf(m) === scoreBasis),
      scoreBandTable: buildScoreBandTable(tabMarkets, names, scoreBasis),
      scoreTotalMarkets: tabMarkets.filter((m) => m.market_type === "score_total" && basisOf(m) === scoreBasis),
      birdies: buildCountTable(tabMarkets, names, "birdies", round, (c) => `${c}+`),
      eagles: buildCountTable(tabMarkets, names, "eagle_count", round, (c) => `${c}+`),
      rare: round == null ? buildRareRows(tabMarkets) : [],
      holeMarkets: round == null ? tabMarkets.filter((m) => m.market_type === "hole_score") : [],
    };
  };

  const renderCategory = (category: CategoryId, round: number | null) => {
    const data = boardData(round);

    switch (category) {
      case "finishes": {
        if (round != null) {
          if (data.roundWinner.length === 0) return noMarkets(round);
          return <div className="space-y-2">{data.roundWinner.map((m) => marketCard(m, m.selections))}</div>;
        }
        if (!data.finishes && data.exact.length === 0 && data.ranges.length === 0) return noMarkets(round);
        return (
          <div className="space-y-3">
            {data.finishes && <MarketTable model={data.finishes} renderCell={renderCell} onPlayer={openStats} />}
            {data.exact.length > 0 && (
              <div className="space-y-2">
                {data.exact.map((m) => {
                  const pid = m.subject_profile_id ?? m.id;
                  const name = (m.subject_profile_id && names[m.subject_profile_id]) || m.display_name;
                  return (
                    <PlayerAccordion
                      key={m.id}
                      name={name}
                      subtitle="Finishing position"
                      open={openExact.has(m.id)}
                      onToggle={() => toggleIn(openExact, setOpenExact, m.id)}
                      onInfo={m.subject_profile_id ? () => openStats(pid) : undefined}
                    >
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {sortExactFinish(m.selections).map((sel) => selectionRow(m, sel))}
                      </div>
                    </PlayerAccordion>
                  );
                })}
              </div>
            )}
            {data.ranges.length > 0 && (
              <div className="space-y-2">{data.ranges.map((m) => marketCard(m, m.selections))}</div>
            )}
          </div>
        );
      }

      case "match": {
        const matchRows = buildMatchRows(data.h2h, names);
        if (matchRows.length === 0) return noMarkets(round);
        return (
          <div>
            {basisToggle}
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full border-collapse rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)]">
                <tbody>
                  {matchRows.map((r) => (
                    <tr key={r.market.id} className="border-b border-[color:var(--sec-hair)] last:border-b-0">
                      <td className="px-1.5 py-2 w-[38%]">
                        <div className="flex flex-col items-center gap-1">
                          <span className="w-full truncate text-center text-[10px] text-[color:var(--sec-muted)]">{r.aName}</span>
                          {renderCell(r.aSelection ? { market: r.market, selection: r.aSelection } : null)}
                        </div>
                      </td>
                      <td className="px-1.5 py-2 w-[24%]">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[9px] uppercase tracking-wider text-[color:var(--sec-muted)]">Draw</span>
                          {renderCell(r.drawSelection ? { market: r.market, selection: r.drawSelection } : null)}
                        </div>
                      </td>
                      <td className="px-1.5 py-2 w-[38%]">
                        <div className="flex flex-col items-center gap-1">
                          <span className="w-full truncate text-center text-[10px] text-[color:var(--sec-muted)]">{r.bName}</span>
                          {renderCell(r.bSelection ? { market: r.market, selection: r.bSelection } : null)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case "scoreBands":
        if (!data.scoreBandTable) return noMarkets(round);
        return (
          <div>
            {basisToggle}
            <MarketTable model={data.scoreBandTable} renderCell={renderBandCell} onPlayer={openStats} />
          </div>
        );

      case "scoreTotals":
        if (data.scoreTotalMarkets.length === 0) return noMarkets(round);
        return (
          <div>
            {basisToggle}
            <div className="space-y-2">
              {data.scoreTotalMarkets.map((m) => {
                const pid = m.subject_profile_id ?? m.id;
                const name = (m.subject_profile_id && names[m.subject_profile_id]) || m.display_name;
                return (
                  <PlayerAccordion
                    key={m.id}
                    name={name}
                    subtitle="Score totals"
                    open={openTotals.has(m.id)}
                    onToggle={() => toggleIn(openTotals, setOpenTotals, m.id)}
                    onInfo={m.subject_profile_id ? () => openStats(pid) : undefined}
                  >
                    <MarketTable model={buildScoreTotalTable(m)} renderCell={renderCell} />
                  </PlayerAccordion>
                );
              })}
            </div>
          </div>
        );

      case "birdies":
        if (!data.birdies) return noMarkets(round);
        return <MarketTable model={data.birdies} renderCell={renderCell} onPlayer={openStats} />;

      case "eagles":
        if (!data.eagles) return noMarkets(round);
        return <MarketTable model={data.eagles} renderCell={renderCell} onPlayer={openStats} />;

      case "rare":
        if (data.rare.length === 0) return noMarkets(round);
        return (
          <div className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] px-3 py-1.5">
            {data.rare.map(({ market, selection }) => (
              <div
                key={market.id}
                className="flex items-center justify-between py-1.5 border-b border-[color:var(--sec-hair)] last:border-b-0"
              >
                <span className="text-[12px] text-[color:var(--sec-muted)] truncate pr-2">{market.display_name}</span>
                {renderCell({ market, selection })}
              </div>
            ))}
          </div>
        );

      case "holes": {
        const holePlayers = [...new Set(data.holeMarkets.map((m) => m.subject_profile_id).filter(Boolean))] as string[];
        if (holePlayers.length === 0) return noMarkets(round);
        return (
          <div className="space-y-2">
            {holePlayers.map((pid) => {
              // Index this player's hole markets BY outcome. Never fall back to
              // "the other one": an unpriced bogey market used to render the
              // birdie book under the "Bogey or worse" tab — identical odds on
              // both tabs, and a bogey click that placed a birdie bet.
              const byOutcome = new Map<HoleOutcome, BoardMarket>();
              for (const m of data.holeMarkets) {
                if (m.subject_profile_id !== pid) continue;
                byOutcome.set(
                  m.params.outcome === "bogey_or_worse" ? "bogey_or_worse" : "birdie_or_better",
                  m
                );
              }
              // Open on the viewer's choice when it's actually available, else on
              // whichever outcome this player has prices for.
              const chosen = holeOutcome.get(pid);
              const outcome: HoleOutcome =
                chosen && byOutcome.has(chosen)
                  ? chosen
                  : HOLE_OUTCOMES.find((o) => byOutcome.has(o.id))?.id ?? "birdie_or_better";
              const active = byOutcome.get(outcome) ?? null;
              return (
                <PlayerAccordion
                  key={pid}
                  name={names[pid] ?? "Player"}
                  subtitle="By hole"
                  open={openHole.has(pid)}
                  onToggle={() => toggleIn(openHole, setOpenHole, pid)}
                  onInfo={() => openStats(pid)}
                >
                  <div className="mb-2 flex rounded-lg border border-[color:var(--sec-hair)] p-0.5 text-[10px]">
                    {HOLE_OUTCOMES.map((o) => {
                      const available = byOutcome.has(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          disabled={!available}
                          onClick={() => {
                            const next = new Map(holeOutcome);
                            next.set(pid, o.id);
                            setHoleOutcome(next);
                          }}
                          className={`flex-1 rounded-md px-2 py-1 font-semibold transition-colors ${
                            outcome === o.id
                              ? "bg-[color:var(--sec-surface-2)] text-[color:var(--sec-accent)]"
                              : available
                              ? "text-[color:var(--sec-muted)]"
                              : "text-[color:var(--sec-muted)] cursor-default"
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="space-y-1">
                    {active ? (
                      sortHoles(active.selections).map((sel) => selectionRow(active, sel))
                    ) : (
                      <p className="px-1 py-2 text-[11px] text-[color:var(--sec-muted)]">
                        No prices for this player.
                      </p>
                    )}
                  </div>
                </PlayerAccordion>
              );
            })}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => router.push("/majors/fantasy")}
          className="text-[11px] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
        >
          ← Fantasy
        </button>
        {stale && (
          <span className="text-[10px] text-amber-300/80 border border-amber-800/40 rounded-full px-2 py-0.5 animate-pulse">
            Updating odds…
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {board?.generated && board?.canGenerate && (
            <button
              type="button"
              onClick={handleRefreshMarkets}
              disabled={refreshingMarkets}
              className="text-[10px] text-[color:var(--sec-muted)] border border-[color:var(--sec-hair)] rounded-full px-2 py-0.5 hover:text-[color:var(--sec-text)] disabled:opacity-50"
              title="Rebuild player profiles and re-price all markets"
            >
              {refreshingMarkets ? "Refreshing…" : "⟳ Refresh"}
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/")}
            className="text-[11px] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
          >
            Home
          </button>
          {process.env.NEXT_PUBLIC_APP_ENV === "sandbox" && (
            <button
              type="button"
              onClick={() => router.push(`/majors/fantasy/events/${eventId}/inspector`)}
              className="text-[10px] text-amber-200/80 border border-amber-800/40 rounded-full px-2 py-0.5 hover:text-amber-100"
            >
              🔬 Inspector
            </button>
          )}
        </div>
      </div>
      <div className="px-4 mb-3">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-bold text-[color:var(--sec-accent)] leading-tight">
            {board?.event?.name ?? "Fantasy Markets"}
          </h1>
          {board?.generated && <OddsFormatMenu className="shrink-0" />}
        </div>
        {board?.state?.last_refreshed_at && (
          <div className="text-[10px] text-[color:var(--sec-muted)] mt-0.5">
            Odds updated {new Date(board.state.last_refreshed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {" · "}fair odds, simulated
            {balance !== null && <>{" · "}balance {balance} pts</>}
          </div>
        )}
      </div>

      {/* Narrative preview */}
      {board?.generated && board.state?.narrative && (
        <div className="px-4 mb-4">
          <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-gradient-to-br from-[color:color-mix(in_srgb,var(--sec-surface)_90%,transparent)] to-[color:color-mix(in_srgb,var(--sec-surface)_90%,transparent)] px-4 py-3">
            <div className="text-[9px] uppercase tracking-[0.2em] text-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] mb-1">
              Event preview
            </div>
            <p className="text-[12px] leading-relaxed text-[color:var(--sec-muted)]">
              {board.state.narrative}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[color:var(--sec-muted)] text-center py-20">Loading…</div>
      ) : !board?.generated ? (
        <div className="px-4">
          <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_80%,transparent)] px-4 py-6 text-center space-y-3">
            <div className="text-sm text-[color:var(--sec-muted)]">
              {board?.error ?? "Markets haven't been generated for this event yet."}
            </div>
            {board?.canGenerate && (
              <>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-5 py-2 rounded-full bg-[color:var(--sec-primary)] text-sm font-semibold text-white hover:bg-[color:var(--sec-primary-hover)] disabled:opacity-50"
                >
                  {generating ? "Generating…" : "Generate Markets"}
                </button>
                {generateError && <div className="text-[11px] text-[color:var(--sec-bad)]">{generateError}</div>}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 pb-12">
          {/* Tabs */}
          {tabs.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1 -mx-1 px-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    activeTab === t.id
                      ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]"
                      : "border border-[color:var(--sec-hair)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {activeTab === SEASON_TAB && seasonId ? (
            <SeasonMarketsPanel seasonId={seasonId} />
          ) : (
            <>
              {/* Category tabs */}
              <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
                {CATEGORY_TABS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveCategory(c.id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      activeCategory === c.id
                        ? "bg-[color:var(--sec-primary)] text-white"
                        : "border border-[color:var(--sec-hair)] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {renderCategory(activeCategory, activeRound)}
            </>
          )}
        </div>
      )}

      {/* Player stats sheet */}
      {statsFor && (
        <PlayerStatsSheet
          name={statsFor.name}
          stats={board?.players?.[statsFor.profileId] ?? null}
          eventCourseId={board?.event?.course_id ?? null}
          onClose={() => setStatsFor(null)}
        />
      )}

      {/* Bet slip (singles + acca) — persists across event pages */}
      <BetSlip
        onPlaced={() => {
          if (board?.event?.group_id) fetchBalance(board.event.group_id);
          fetchBoard();
        }}
      />
    </div>
  );
}

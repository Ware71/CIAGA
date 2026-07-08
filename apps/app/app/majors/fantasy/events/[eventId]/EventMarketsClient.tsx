"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ChevronDown, Info } from "lucide-react";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { supabase } from "@/lib/supabaseClient";
import { safeJson } from "@/lib/fantasy/safeJson";
import { MARKET_GROUPS } from "@/lib/fantasy/markets/types";
import { OddsFormatToggle, OddsValue } from "@/components/fantasy/OddsValue";
import { PlayerStatsSheet, type PlayerStats } from "@/components/fantasy/PlayerStatsSheet";

type Selection = {
  key: string;
  label: string;
  probability: number;
  decimal_odds: number;
  snapshot_id: string;
  event_version: number;
};

type BoardMarket = {
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

type BoardResponse = {
  generated: boolean;
  event: { id: string; name: string; status: string; group_id: string; course_id: string | null };
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

export default function EventMarketsClient({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Accordion — group ids currently open; seeded once from the first board.
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  // Price movement flashes: `${marketId}|${selectionKey}` → up/down.
  const prevOdds = useRef<Map<string, number>>(new Map());
  const [flashes, setFlashes] = useState<Map<string, "up" | "down">>(new Map());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Player stats sheet
  const [statsFor, setStatsFor] = useState<{ profileId: string; name: string } | null>(null);
  // Pick slip
  const [slip, setSlip] = useState<{ market: BoardMarket; selection: Selection } | null>(null);
  const [stake, setStake] = useState(10);
  const [placing, setPlacing] = useState(false);
  const [slipError, setSlipError] = useState<string | null>(null);
  const [slipSuccess, setSlipSuccess] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const fetchBalance = useCallback(async (groupId: string) => {
    const session = await getViewerSession();
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
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/fantasy/events/${eventId}/odds`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const j = (await safeJson(res)) as BoardResponse;
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

  // Realtime: refetch when the event's fantasy state flips (debounced refresh
  // done elsewhere, staleness bump from a live score, settlement).
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
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchBoard();
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
      const session = await getViewerSession();
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

  const openSlip = (market: BoardMarket, selection: Selection) => {
    setSlip({ market, selection });
    setStake(10);
    setSlipError(null);
    setSlipSuccess(null);
  };

  const handlePlacePick = async () => {
    if (!slip) return;
    setPlacing(true);
    setSlipError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/fantasy/picks", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: slip.market.id,
          selectionKey: slip.selection.key,
          snapshotId: slip.selection.snapshot_id,
          stake,
        }),
      });
      const j = await safeJson(res);
      if (!res.ok) {
        setSlipError(j.error ?? "Failed to place pick");
        // Stale-odds rejection → refetch so the user sees current prices.
        if (String(j.error ?? "").toLowerCase().includes("stale")) fetchBoard();
        return;
      }
      setSlipSuccess(`Pick placed — ${stake} pts on ${slip.selection.label}`);
      if (board?.event?.group_id) fetchBalance(board.event.group_id);
    } finally {
      setPlacing(false);
    }
  };

  const openStats = (profileId: string) => {
    setStatsFor({ profileId, name: board?.names?.[profileId] ?? "Player" });
  };

  const stale = !!board?.state?.odds_stale;
  const boardLocked = !!board?.state?.is_final || board?.event?.status === "completed";
  const markets = board?.markets ?? [];

  const sections = MARKET_GROUPS.map((g) => ({
    ...g,
    markets: markets.filter((m) => (m.group ?? "") === g.id && m.selections.length > 0),
  })).filter((s) => s.markets.length > 0);

  // Seed the accordion once: first section open, the rest labeled + collapsed.
  useEffect(() => {
    if (expanded === null && sections.length > 0) {
      setExpanded(new Set([sections[0].id]));
    }
  }, [expanded, sections]);

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => router.push("/majors/fantasy")}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← Fantasy
        </button>
        {stale && (
          <span className="text-[10px] text-amber-300/80 border border-amber-800/40 rounded-full px-2 py-0.5 animate-pulse">
            Updating odds…
          </span>
        )}
        {process.env.NEXT_PUBLIC_APP_ENV === "sandbox" && (
          <button
            type="button"
            onClick={() => router.push(`/majors/fantasy/events/${eventId}/inspector`)}
            className="ml-auto text-[10px] text-amber-200/80 border border-amber-800/40 rounded-full px-2 py-0.5 hover:text-amber-100"
          >
            🔬 Inspector
          </button>
        )}
      </div>
      <div className="px-4 mb-3">
        <h1 className="text-lg font-bold text-[#f5e6b0] leading-tight">
          {board?.event?.name ?? "Fantasy Markets"}
        </h1>
        {board?.state?.last_refreshed_at && (
          <div className="text-[10px] text-emerald-200/45 mt-0.5">
            Odds updated {new Date(board.state.last_refreshed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {" · "}fair odds, simulated
          </div>
        )}
      </div>

      {/* Narrative preview */}
      {board?.generated && board.state?.narrative && (
        <div className="px-4 mb-4">
          <div className="rounded-2xl border border-emerald-900/60 bg-gradient-to-br from-[#0b3b21]/90 to-[#07301a]/90 px-4 py-3">
            <div className="text-[9px] uppercase tracking-[0.2em] text-[#f5e6b0]/60 mb-1">
              Event preview
            </div>
            <p className="text-[12px] leading-relaxed text-emerald-100/85">
              {board.state.narrative}
            </p>
          </div>
        </div>
      )}

      {/* Odds format toggle */}
      {board?.generated && (
        <div className="px-4 mb-4">
          <OddsFormatToggle />
        </div>
      )}

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : !board?.generated ? (
        <div className="px-4">
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center space-y-3">
            <div className="text-sm text-emerald-100/70">
              {board?.error ?? "Markets haven't been generated for this event yet."}
            </div>
            {board?.canGenerate && (
              <>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-5 py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {generating ? "Generating…" : "Generate Markets"}
                </button>
                {generateError && <div className="text-[11px] text-red-300">{generateError}</div>}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="px-4 space-y-3 pb-12">
          {sections.length === 0 && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center text-sm text-emerald-100/70">
              No open markets.
            </div>
          )}
          {sections.map((section) => {
            const open = expanded?.has(section.id) ?? false;
            return (
              <section
                key={section.id}
                className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/40 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f5e6b0]/80">
                    {section.label}
                  </span>
                  <span className="flex items-center gap-1.5 text-emerald-200/50">
                    <span className="text-[10px]">{section.markets.length}</span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>
                {open && (
                  <div className="px-2.5 pb-2.5 space-y-2">
                    {section.markets.map((market) => (
                      <div
                        key={market.id}
                        className={`rounded-xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5 ${market.status === "suspended" ? "opacity-50" : ""}`}
                      >
                        {market.market_type !== "outright_winner" && (
                          <div className="flex items-center justify-between mb-1.5">
                            <button
                              type="button"
                              disabled={!market.subject_profile_id}
                              onClick={() =>
                                market.subject_profile_id && openStats(market.subject_profile_id)
                              }
                              className="flex items-center gap-1 text-[12px] font-semibold text-emerald-100 disabled:cursor-default"
                            >
                              <span className="truncate">{market.display_name}</span>
                              {market.subject_profile_id && (
                                <Info className="h-3 w-3 shrink-0 text-emerald-100/40" />
                              )}
                            </button>
                            {market.status === "suspended" && (
                              <span className="text-[9px] text-amber-300/70 uppercase tracking-wider">Suspended</span>
                            )}
                          </div>
                        )}
                        <div className="space-y-1">
                          {market.selections.map((sel) => {
                            const canBack = !stale && !boardLocked && market.status === "open";
                            const flash = flashes.get(`${market.id}|${sel.key}`);
                            const isPlayerKey = UUID_RE.test(sel.key);
                            return (
                              <div
                                key={sel.key}
                                className="flex items-center justify-between py-1 border-b border-emerald-900/20 last:border-b-0"
                              >
                                <span className="flex min-w-0 items-center gap-1 pr-2">
                                  <span className="text-[12px] text-emerald-100/85 truncate">{sel.label}</span>
                                  {isPlayerKey && (
                                    <button
                                      type="button"
                                      aria-label={`About ${sel.label}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openStats(sel.key);
                                      }}
                                      className="shrink-0 text-emerald-100/35 hover:text-emerald-100/80"
                                    >
                                      <Info className="h-3 w-3" />
                                    </button>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  disabled={!canBack}
                                  onClick={() => openSlip(market, sel)}
                                  className={`shrink-0 min-w-[58px] text-center rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-default ${
                                    stale
                                      ? "border-emerald-900/50 text-emerald-200/40 animate-pulse"
                                      : flash === "up"
                                      ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-300"
                                      : flash === "down"
                                      ? "border-red-400/50 bg-red-500/10 text-red-300"
                                      : canBack
                                      ? "border-emerald-700/50 bg-emerald-950/40 text-[#f5e6b0] hover:bg-emerald-800/40 active:scale-95"
                                      : "border-emerald-900/50 text-emerald-200/50"
                                  }`}
                                >
                                  <OddsValue odds={sel.decimal_odds} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
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

      {/* Pick slip drawer */}
      {slip && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setSlip(null)}
              className="absolute inset-0 bg-black/60"
            />
            <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-emerald-900/70 bg-[#07301a] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              {slipSuccess ? (
                <div className="text-center space-y-3 py-2">
                  <div className="text-sm font-bold text-emerald-300">{slipSuccess}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSlip(null)}
                      className="flex-1 py-2 rounded-full border border-emerald-900/60 text-[12px] text-emerald-200/70"
                    >
                      Back to markets
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/majors/fantasy/picks")}
                      className="flex-1 py-2 rounded-full bg-emerald-700 text-[12px] font-semibold text-white"
                    >
                      My picks →
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-1">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#f5e6b0] truncate">{slip.selection.label}</div>
                      <div className="text-[11px] text-emerald-200/60">{slip.market.display_name}</div>
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-700/50 px-2.5 py-1 text-[12px] font-bold text-[#f5e6b0]">
                      <OddsValue odds={slip.selection.decimal_odds} />
                    </span>
                  </div>
                  {balance !== null && (
                    <div className="text-[10px] text-emerald-200/50 mb-3">Balance: {balance} pts</div>
                  )}

                  <div className="flex items-center justify-center gap-4 mb-2">
                    <button
                      type="button"
                      onClick={() => setStake((s) => Math.max(1, s - 5))}
                      className="h-10 w-10 rounded-full border border-emerald-900/60 text-emerald-200 text-lg"
                    >
                      −
                    </button>
                    <div className="text-center min-w-[90px]">
                      <div className="text-2xl font-bold text-emerald-50">{stake}</div>
                      <div className="text-[10px] text-emerald-200/50">points stake</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStake((s) => s + 5)}
                      className="h-10 w-10 rounded-full border border-emerald-900/60 text-emerald-200 text-lg"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex justify-center gap-1.5 mb-3">
                    {[5, 10, 25, 50].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setStake(q)}
                        className={`px-3 py-1 rounded-full text-[10px] font-semibold border ${stake === q ? "bg-emerald-700 text-white border-emerald-600" : "border-emerald-900/60 text-emerald-200/60"}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>

                  <div className="text-center text-[11px] text-emerald-200/60 mb-3">
                    Potential return:{" "}
                    <span className="font-bold text-[#f5e6b0]">
                      {(stake * slip.selection.decimal_odds).toFixed(2)} pts
                    </span>
                  </div>

                  {slipError && (
                    <div className="text-[11px] text-red-300 text-center mb-3">{slipError}</div>
                  )}

                  <button
                    type="button"
                    onClick={handlePlacePick}
                    disabled={placing || (balance !== null && stake > balance)}
                    className="w-full py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {placing
                      ? "Placing…"
                      : balance !== null && stake > balance
                      ? "Insufficient balance"
                      : `Place pick — ${stake} pts`}
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { supabase } from "@/lib/supabaseClient";

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
  display_name: string;
  status: string;
  params: Record<string, unknown>;
  subject_profile_id: string | null;
  opponent_profile_id: string | null;
  selections: Selection[];
};

type BoardResponse = {
  generated: boolean;
  event: { id: string; name: string; status: string; group_id: string };
  state?: { version: number; odds_stale: boolean; last_refreshed_at: string | null; is_final: boolean };
  refreshing?: boolean;
  markets?: BoardMarket[];
  names?: Record<string, string>;
  canGenerate?: boolean;
  error?: string;
};

const SECTION_LABELS: Record<string, string> = {
  outright_winner: "Outright Winner",
  top_n: "Finishing Position",
  h2h: "Head to Head",
  gross_ou: "Gross Score Over/Under",
  net_ou: "Net Score Over/Under",
  birdies: "Birdies",
};

const SECTION_ORDER = ["outright_winner", "top_n", "h2h", "gross_ou", "net_ou", "birdies"];

function fmtOdds(odds: number): string {
  return odds.toFixed(2);
}

export default function EventMarketsClient({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const j = (await res.json()) as BoardResponse;
    if (res.ok) setBoard(j);
    else setBoard((prev) => prev ?? ({ generated: false, error: j.error } as BoardResponse));
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
      const j = await res.json();
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
      const j = await res.json();
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

  const stale = !!board?.state?.odds_stale;
  const boardLocked = !!board?.state?.is_final || board?.event?.status === "completed";
  const markets = board?.markets ?? [];

  const sections = SECTION_ORDER.map((type) => ({
    type,
    label: SECTION_LABELS[type] ?? type,
    markets: markets.filter((m) => m.market_type === type && m.selections.length > 0),
  })).filter((s) => s.markets.length > 0);

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center justify-between mb-2">
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
      </div>
      <div className="px-4 mb-5">
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
        <div className="px-4 space-y-6 pb-12">
          {sections.length === 0 && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center text-sm text-emerald-100/70">
              No open markets.
            </div>
          )}
          {sections.map((section) => (
            <section key={section.type} className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50">
                {section.label}
              </h2>
              {section.markets.map((market) => (
                <div
                  key={market.id}
                  className={`rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5 ${market.status === "suspended" ? "opacity-50" : ""}`}
                >
                  {section.type !== "outright_winner" && (
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[12px] font-semibold text-emerald-100">{market.display_name}</div>
                      {market.status === "suspended" && (
                        <span className="text-[9px] text-amber-300/70 uppercase tracking-wider">Suspended</span>
                      )}
                    </div>
                  )}
                  <div className="space-y-1">
                    {market.selections.map((sel) => {
                      const canBack = !stale && !boardLocked && market.status === "open";
                      return (
                        <button
                          key={sel.key}
                          type="button"
                          disabled={!canBack}
                          onClick={() => openSlip(market, sel)}
                          className="w-full flex items-center justify-between py-1 border-b border-emerald-900/20 last:border-b-0 disabled:cursor-default"
                        >
                          <span className="text-[12px] text-emerald-100/85 truncate pr-2">{sel.label}</span>
                          <span
                            className={`shrink-0 min-w-[52px] text-center rounded-full border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                              stale
                                ? "border-emerald-900/50 text-emerald-200/40 animate-pulse"
                                : canBack
                                ? "border-emerald-700/50 text-[#f5e6b0] hover:bg-emerald-800/40"
                                : "border-emerald-900/50 text-emerald-200/50"
                            }`}
                          >
                            {fmtOdds(sel.decimal_odds)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
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
                      {fmtOdds(slip.selection.decimal_odds)}
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

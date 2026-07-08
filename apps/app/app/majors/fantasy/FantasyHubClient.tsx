"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { FantasyConfig } from "@/lib/fantasy/types";

type FantasyGroupSummary = {
  group: { id: string; name: string; image_url: string | null };
  role: string;
  config: FantasyConfig;
  balance: number | null;
  pnl: number;
};

type FantasyEventSummary = {
  id: string;
  name: string;
  group_id: string;
  group_name: string;
  event_date: string | null;
  majors_status: string;
  has_markets: boolean;
};

function formatPoints(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function pnlClass(pnl: number): string {
  if (pnl > 0) return "text-emerald-300";
  if (pnl < 0) return "text-red-300";
  return "text-emerald-100/60";
}

export default function FantasyHubClient() {
  const router = useRouter();
  const [groups, setGroups] = useState<FantasyGroupSummary[]>([]);
  const [events, setEvents] = useState<FantasyEventSummary[]>([]);
  const [openPicks, setOpenPicks] = useState<
    { id: string; event_id: string; selection_label: string; market_label: string; stake: number; potential_return: number }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [topupGroup, setTopupGroup] = useState<FantasyGroupSummary | null>(null);
  const [topupUnits, setTopupUnits] = useState(1);
  const [toppingUp, setToppingUp] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const [meRes, picksRes] = await Promise.all([
      fetch("/api/fantasy/me", { headers }),
      fetch("/api/fantasy/picks", { headers }),
    ]);
    if (meRes.ok) {
      const j = await meRes.json();
      setGroups(j.groups ?? []);
      setEvents(j.events ?? []);
    }
    if (picksRes.ok) {
      const j = await picksRes.json();
      setOpenPicks((j.picks ?? []).filter((p: { status: string }) => p.status === "open"));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchGroups();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchGroups]);

  const handleTopUp = async () => {
    if (!topupGroup) return;
    setToppingUp(true);
    setTopupError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/groups/${topupGroup.group.id}/topup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ units: topupUnits }),
      });
      const j = await res.json();
      if (!res.ok) {
        setTopupError(j.error ?? "Top-up failed");
        return;
      }
      setTopupGroup(null);
      setTopupUnits(1);
      await fetchGroups();
    } finally {
      setToppingUp(false);
    }
  };

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50 flex items-center gap-1"
        >
          ← Home
        </button>
        <h1 className="text-lg font-bold tracking-wide text-[#f5e6b0]">Fantasy Picks</h1>
        <div className="w-12" />
      </div>

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : (
        <div className="px-4 space-y-8 pb-12">
          {/* Wallets */}
          <section className="space-y-2">
            <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50">My Wallets</h2>
            {groups.length === 0 ? (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-5 text-center">
                <div className="text-sm text-emerald-100/70">
                  Fantasy picks aren&apos;t enabled in any of your groups yet.
                </div>
                <div className="text-[11px] text-emerald-200/50 mt-1">
                  Group admins can enable it from the group&apos;s Settings tab.
                </div>
              </div>
            ) : (
              groups.map((g) => (
                <div
                  key={g.group.id}
                  className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-3 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-800/60 to-emerald-950 flex items-center justify-center text-sm font-bold text-emerald-200 shrink-0">
                      {g.group.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => router.push(`/majors/groups/${g.group.id}`)}
                        className="text-sm font-semibold text-emerald-50 truncate block"
                      >
                        {g.group.name}
                      </button>
                      <div className="text-[10px] text-emerald-200/50 mt-0.5">
                        {g.config.mode === "topup" ? "Top-up budget" : "Fixed budget"} ·{" "}
                        {g.config.budgetScope === "event" ? "per event" : "per season"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {g.balance !== null && (
                        <div className="text-sm font-bold text-[#f5e6b0]">{formatPoints(g.balance)} pts</div>
                      )}
                      <div className={`text-[11px] font-semibold ${pnlClass(g.pnl)}`}>
                        {g.pnl > 0 ? "+" : ""}{formatPoints(g.pnl)} PnL
                      </div>
                    </div>
                  </div>
                  {g.config.mode === "topup" && (
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => { setTopupGroup(g); setTopupUnits(1); setTopupError(null); }}
                        className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                      >
                        + Top up
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          {/* Open picks */}
          {openPicks.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50">Open Picks</h2>
                <button
                  type="button"
                  onClick={() => router.push("/majors/fantasy/picks")}
                  className="text-[10px] text-emerald-400/80 hover:text-emerald-300"
                >
                  View all →
                </button>
              </div>
              {openPicks.slice(0, 3).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => router.push("/majors/fantasy/picks")}
                  className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-emerald-50 truncate">{p.selection_label}</div>
                      <div className="text-[10px] text-emerald-200/50 truncate">{p.market_label}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] font-bold text-[#f5e6b0]">{p.stake} pts</div>
                      <div className="text-[9px] text-emerald-200/45">→ {p.potential_return}</div>
                    </div>
                  </div>
                </button>
              ))}
            </section>
          )}

          {/* Events with markets */}
          {groups.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50">Events</h2>
              {events.length === 0 ? (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-5 text-center">
                  <div className="text-sm text-emerald-100/70">No upcoming events</div>
                  <div className="text-[11px] text-emerald-200/50 mt-1">
                    Markets appear here when your groups schedule events.
                  </div>
                </div>
              ) : (
                events.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => router.push(`/majors/fantasy/events/${e.id}`)}
                    className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5 hover:bg-emerald-900/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-emerald-50 truncate">{e.name}</div>
                        <div className="text-[10px] text-emerald-200/50 mt-0.5">
                          {e.group_name}
                          {e.event_date && ` · ${new Date(e.event_date).toLocaleDateString([], { month: "short", day: "numeric" })}`}
                          {e.majors_status === "live" && " · LIVE"}
                        </div>
                      </div>
                      <span className={`shrink-0 text-[10px] font-semibold ${e.has_markets ? "text-emerald-400" : "text-emerald-200/40"}`}>
                        {e.has_markets ? "Markets →" : "No markets yet"}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </section>
          )}

          {/* Shortcuts */}
          {groups.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50">More</h2>
              <button
                type="button"
                onClick={() => router.push("/majors/fantasy/leaderboard")}
                className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5 hover:bg-emerald-900/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-emerald-50">Fantasy Leaderboard</div>
                    <div className="text-[10px] text-emerald-200/50 mt-0.5">Net-profit rankings per group</div>
                  </div>
                  <span className="text-[10px] text-emerald-400/80">Open →</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => router.push("/majors/fantasy/picks")}
                className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5 hover:bg-emerald-900/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-emerald-50">My Picks</div>
                    <div className="text-[10px] text-emerald-200/50 mt-0.5">Open picks, history and cash-outs</div>
                  </div>
                  <span className="text-[10px] text-emerald-400/80">Open →</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => router.push("/majors/fantasy/profiles")}
                className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5 hover:bg-emerald-900/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-semibold text-emerald-50">Performance Profiles</div>
                    <div className="text-[10px] text-emerald-200/50 mt-0.5">The stats behind the odds</div>
                  </div>
                  <span className="text-[10px] text-emerald-400/80">Open →</span>
                </div>
              </button>
            </section>
          )}
        </div>
      )}

      {/* Top-up drawer */}
      {topupGroup && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setTopupGroup(null)}
              className="absolute inset-0 bg-black/60"
            />
            <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-emerald-900/70 bg-[#07301a] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              <div className="text-sm font-bold text-[#f5e6b0] mb-1">Top up wallet</div>
              <div className="text-[11px] text-emerald-200/60 mb-4">
                {topupGroup.group.name} · {formatPoints(topupGroup.config.topupIncrement ?? 0)} pts per unit.
                Top-ups don&apos;t count toward PnL.
              </div>
              <div className="flex items-center justify-center gap-5 mb-4">
                <button
                  type="button"
                  onClick={() => setTopupUnits((u) => Math.max(1, u - 1))}
                  className="h-10 w-10 rounded-full border border-emerald-900/60 text-emerald-200 text-lg"
                >
                  −
                </button>
                <div className="text-center min-w-[90px]">
                  <div className="text-2xl font-bold text-emerald-50">
                    {formatPoints(topupUnits * (topupGroup.config.topupIncrement ?? 0))}
                  </div>
                  <div className="text-[10px] text-emerald-200/50">points</div>
                </div>
                <button
                  type="button"
                  onClick={() => setTopupUnits((u) => Math.min(100, u + 1))}
                  className="h-10 w-10 rounded-full border border-emerald-900/60 text-emerald-200 text-lg"
                >
                  +
                </button>
              </div>
              {topupError && (
                <div className="text-[11px] text-red-300 text-center mb-3">{topupError}</div>
              )}
              <button
                type="button"
                onClick={handleTopUp}
                disabled={toppingUp}
                className="w-full py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {toppingUp ? "Topping up…" : "Confirm top-up"}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

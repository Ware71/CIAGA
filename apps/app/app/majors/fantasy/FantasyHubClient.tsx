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
  group_id: string;
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
  const [loading, setLoading] = useState(true);
  const [topupGroup, setTopupGroup] = useState<FantasyGroupSummary | null>(null);
  const [topupUnits, setTopupUnits] = useState(1);
  const [toppingUp, setToppingUp] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);

  /** Returns true when it redirected away (caller should keep loading=true). */
  const fetchGroups = useCallback(async (): Promise<boolean> => {
    const session = await getViewerSession();
    if (!session) return false;
    const res = await fetch("/api/fantasy/me", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) return false;
    const j = await res.json();
    const fetchedGroups: FantasyGroupSummary[] = j.groups ?? [];
    // Exactly one fantasy-enabled wallet — skip straight to it on first entry.
    // A per-session flag stops this re-firing when the user navigates BACK to
    // the hub (via "← Wallets" or the New Picks tab): otherwise single-group
    // users get bounced group → hub → group forever and can never reach the
    // Home button that lives on this page.
    if (fetchedGroups.length === 1) {
      const jumpedKey = "ciaga:fantasy:hub-redirected";
      const alreadyJumped =
        typeof sessionStorage !== "undefined" && sessionStorage.getItem(jumpedKey) === "1";
      if (!alreadyJumped) {
        if (typeof sessionStorage !== "undefined") sessionStorage.setItem(jumpedKey, "1");
        router.replace(`/majors/fantasy/groups/${fetchedGroups[0].group.id}`);
        return true;
      }
      // Returning to the hub — render the single wallet (with its Home button).
    }
    setGroups(fetchedGroups);
    setEvents(j.events ?? []);
    return false;
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let redirected = false;
      try {
        redirected = await fetchGroups();
      } finally {
        // Stay in the loading state through a redirect — no flash of the list.
        if (!cancelled && !redirected) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const eventCounts = (groupId: string) => {
    const mine = events.filter((e) => e.group_id === groupId);
    return {
      live: mine.filter((e) => e.majors_status === "live").length,
      open: mine.filter((e) => e.majors_status !== "completed" && e.majors_status !== "cancelled").length,
    };
  };

  return (
    <div className="min-h-[100dvh] max-w-sm mx-auto">
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
        <div className="px-4 pb-8">
          <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50 mb-2">My Wallets</h2>
          {groups.length === 0 ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center">
              <div className="text-sm text-emerald-100/70">
                Fantasy picks aren&apos;t enabled in any of your groups yet.
              </div>
              <div className="text-[11px] text-emerald-200/50 mt-1">
                Group admins can enable it from the group&apos;s Settings tab.
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {groups.map((g) => {
                const counts = eventCounts(g.group.id);
                return (
                  <div
                    key={g.group.id}
                    className="rounded-2xl border border-emerald-900/70 bg-gradient-to-br from-[#0b3b21]/90 to-[#07301a]/90 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => router.push(`/majors/fantasy/groups/${g.group.id}`)}
                      className="w-full text-left px-3.5 py-3 hover:bg-emerald-900/20 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-800/60 to-emerald-950 flex items-center justify-center text-sm font-bold text-emerald-200 shrink-0">
                          {g.group.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-emerald-50 truncate">{g.group.name}</div>
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
                            {g.pnl > 0 ? "+" : ""}
                            {formatPoints(g.pnl)} PnL
                          </div>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        {counts.live > 0 && (
                          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-300">
                            {counts.live} Live
                          </span>
                        )}
                        <span className="rounded-full border border-emerald-800/50 px-2 py-0.5 text-[9px] font-semibold text-emerald-200/70">
                          {counts.open} event{counts.open === 1 ? "" : "s"} + season
                        </span>
                        <span className="ml-auto text-[11px] font-semibold text-emerald-400">Markets →</span>
                      </div>
                    </button>
                    {g.config.mode === "topup" && (
                      <div className="flex justify-end border-t border-emerald-900/50 px-3.5 py-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setTopupGroup(g);
                            setTopupUnits(1);
                            setTopupError(null);
                          }}
                          className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                        >
                          + Top up
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
              {topupError && <div className="text-[11px] text-red-300 text-center mb-3">{topupError}</div>}
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

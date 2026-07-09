"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { OddsFormatMenu, OddsValue } from "@/components/fantasy/OddsValue";
import type { FantasyConfig } from "@/lib/fantasy/types";

type GroupSummary = {
  group: { id: string; name: string; image_url: string | null };
  config: FantasyConfig;
  balance: number | null;
  pnl: number;
};

type EventSummary = {
  id: string;
  name: string;
  group_id: string;
  event_date: string | null;
  majors_status: string;
  has_markets: boolean;
};

/** A headline season market surfaced on the coupon (Phase 5 season board). */
type SeasonHeadline = {
  seasonId: string;
  seasonName: string;
  marketLabel: string;
  selections: { label: string; decimal_odds: number }[];
};

function formatPoints(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

export default function GroupMarketsClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [season, setSeason] = useState<SeasonHeadline | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupUnits, setTopupUnits] = useState(1);
  const [toppingUp, setToppingUp] = useState(false);

  const load = useCallback(async () => {
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const [meRes, seasonRes] = await Promise.all([
      fetch("/api/fantasy/me", { headers }),
      // Season markets are optional (Phase 5) — degrade gracefully if absent.
      fetch(`/api/fantasy/groups/${groupId}/season`, { headers }).catch(() => null),
    ]);
    if (meRes.ok) {
      const j = await meRes.json();
      const g = (j.groups ?? []).find((x: GroupSummary) => x.group.id === groupId) ?? null;
      setGroup(g);
      setEvents((j.events ?? []).filter((e: EventSummary) => e.group_id === groupId));
    }
    if (seasonRes && seasonRes.ok) {
      const s = await seasonRes.json().catch(() => null);
      if (s?.headline) setSeason(s.headline as SeasonHeadline);
    }
  }, [groupId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleTopUp = async () => {
    setToppingUp(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      await fetch(`/api/fantasy/groups/${groupId}/topup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ units: topupUnits }),
      });
      setTopupOpen(false);
      setTopupUnits(1);
      await load();
    } finally {
      setToppingUp(false);
    }
  };

  const sortedEvents = [...events].sort((a, b) => {
    const live = (e: EventSummary) => (e.majors_status === "live" ? 0 : 1);
    if (live(a) !== live(b)) return live(a) - live(b);
    return (a.event_date ?? "").localeCompare(b.event_date ?? "");
  });

  return (
    <div className="min-h-[100dvh] max-w-sm mx-auto">
      <div className="px-4 pt-8 flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => router.push("/majors/fantasy")}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← Wallets
        </button>
        <OddsFormatMenu />
      </div>

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : !group ? (
        <div className="px-4 py-20 text-center text-sm text-emerald-100/70">Group not found.</div>
      ) : (
        <div className="px-4 pb-8 space-y-5">
          {/* Wallet header */}
          <div className="rounded-2xl border border-emerald-900/70 bg-gradient-to-br from-[#0b3b21]/90 to-[#07301a]/90 px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-[#f5e6b0] truncate">{group.group.name}</h1>
                <div className="text-[10px] text-emerald-200/50 mt-0.5">
                  {group.config.mode === "topup" ? "Top-up" : "Fixed"} ·{" "}
                  {group.config.budgetScope === "event" ? "per event" : "per season"}
                </div>
              </div>
              <div className="text-right shrink-0">
                {group.balance !== null && (
                  <div className="text-base font-bold text-[#f5e6b0]">{formatPoints(group.balance)} pts</div>
                )}
                {group.config.mode === "topup" && (
                  <button
                    type="button"
                    onClick={() => setTopupOpen(true)}
                    className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    + Top up
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Season markets */}
          {season && (
            <section>
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50 mb-2">
                Season · {season.seasonName}
              </h2>
              <button
                type="button"
                onClick={() => router.push(`/majors/fantasy/seasons/${season.seasonId}`)}
                className="w-full text-left rounded-2xl border border-[#f5e6b0]/25 bg-[#0b3b21]/70 px-3.5 py-3 hover:bg-emerald-900/30 transition-colors"
              >
                <div className="text-[12px] font-semibold text-emerald-50 mb-1.5">{season.marketLabel}</div>
                <div className="flex flex-wrap gap-1.5">
                  {season.selections.slice(0, 3).map((s) => (
                    <span
                      key={s.label}
                      className="flex items-center gap-1 rounded-lg border border-emerald-800/50 bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-100/85"
                    >
                      {s.label}
                      <span className="font-bold text-[#f5e6b0]">
                        <OddsValue odds={s.decimal_odds} />
                      </span>
                    </span>
                  ))}
                  <span className="ml-auto self-center text-[11px] font-semibold text-emerald-400">All →</span>
                </div>
              </button>
            </section>
          )}

          {/* Events coupon */}
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/50 mb-2">Events</h2>
            {sortedEvents.length === 0 ? (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-5 text-center text-sm text-emerald-100/70">
                No upcoming events.
              </div>
            ) : (
              <div className="space-y-2">
                {sortedEvents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => router.push(`/majors/fantasy/events/${e.id}`)}
                    className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3.5 py-3 hover:bg-emerald-900/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-emerald-50 truncate">{e.name}</div>
                        <div className="text-[10px] text-emerald-200/50 mt-0.5">
                          {e.event_date
                            ? new Date(e.event_date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
                            : "Date TBC"}
                          {e.majors_status === "live" && " · LIVE"}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] font-semibold ${
                          e.has_markets ? "text-emerald-400" : "text-emerald-200/40"
                        }`}
                      >
                        {e.has_markets ? "Markets →" : "Soon"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {topupOpen && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end">
            <button type="button" aria-label="Close" onClick={() => setTopupOpen(false)} className="absolute inset-0 bg-black/60" />
            <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-emerald-900/70 bg-[#07301a] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              <div className="text-sm font-bold text-[#f5e6b0] mb-1">Top up wallet</div>
              <div className="text-[11px] text-emerald-200/60 mb-4">
                {formatPoints(group?.config.topupIncrement ?? 0)} pts per unit. Top-ups don&apos;t count toward PnL.
              </div>
              <div className="flex items-center justify-center gap-5 mb-4">
                <button type="button" onClick={() => setTopupUnits((u) => Math.max(1, u - 1))} className="h-10 w-10 rounded-full border border-emerald-900/60 text-emerald-200 text-lg">−</button>
                <div className="text-center min-w-[90px]">
                  <div className="text-2xl font-bold text-emerald-50">{formatPoints(topupUnits * (group?.config.topupIncrement ?? 0))}</div>
                  <div className="text-[10px] text-emerald-200/50">points</div>
                </div>
                <button type="button" onClick={() => setTopupUnits((u) => Math.min(100, u + 1))} className="h-10 w-10 rounded-full border border-emerald-900/60 text-emerald-200 text-lg">+</button>
              </div>
              <button type="button" onClick={handleTopUp} disabled={toppingUp} className="w-full py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
                {toppingUp ? "Topping up…" : "Confirm top-up"}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

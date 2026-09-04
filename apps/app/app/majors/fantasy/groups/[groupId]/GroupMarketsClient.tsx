"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { OddsFormatMenu, OddsValue } from "@/components/fantasy/OddsValue";
import type { FantasyConfig } from "@/lib/fantasy/types";
import type { PreviewTableModel } from "@/lib/fantasy/board/groupBoard";

type GroupSummary = {
  group: { id: string; name: string; image_url: string | null };
  role: string;
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
  preview: PreviewTableModel | null;
  narrative: string | null;
};

/** A headline season market surfaced on the coupon (Win / Top 3 preview). */
type SeasonHeadline = {
  seasonId: string;
  seasonName: string;
  preview: PreviewTableModel;
};

/** Small non-interactive Win/Top-3 preview grid used on both the season and
 * event coupon cards — same shape MarketTable renders full-size, no odds
 * pills you can tap (these cards only navigate, they never place bets). */
function PreviewTable({ model }: { model: PreviewTableModel }) {
  if (model.rows.length === 0) return null;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="px-1 py-1 text-left text-[9px] font-semibold uppercase tracking-wider text-[color:var(--sec-muted)]" />
            {model.columns.map((c) => (
              <th
                key={c.id}
                className="px-1 py-1 text-center text-[9px] font-semibold uppercase tracking-wider text-[color:var(--sec-muted)] whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.profileId} className="border-t border-[color:var(--sec-hair)]">
              <td className="px-1 py-1 max-w-[110px]">
                <span className="block truncate text-[11px] text-[color:var(--sec-muted)]">{row.name}</span>
              </td>
              {row.cells.map((cell, i) => (
                <td key={model.columns[i]?.id ?? i} className="px-1 py-1 text-center">
                  {cell ? (
                    <span className="inline-block min-w-[46px] rounded-lg border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-1.5 py-0.5 text-[11px] font-bold text-[color:var(--sec-accent)]">
                      <OddsValue odds={cell.decimal_odds} />
                    </span>
                  ) : (
                    <span className="text-[11px] text-[color:var(--sec-muted)]">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const [refreshingAll, setRefreshingAll] = useState(false);

  const load = useCallback(async () => {
    const session = await requireViewerSession();
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
      const session = await requireViewerSession();
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

  const isAdmin = group?.role === "owner" || group?.role === "admin";

  // Admin "Refresh all": rebuild every field profile then force-reprice every
  // active event + the season markets in the group.
  const handleRefreshAll = async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      await fetch(`/api/fantasy/groups/${groupId}/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      await load();
    } finally {
      setRefreshingAll(false);
    }
  };

  const sortedEvents = [...events].sort((a, b) => {
    const live = (e: EventSummary) => (e.majors_status === "live" ? 0 : 1);
    if (live(a) !== live(b)) return live(a) - live(b);
    return (a.event_date ?? "").localeCompare(b.event_date ?? "");
  });

  return (
    <div className="min-h-[100dvh] max-w-sm mx-auto">
      <div className="px-4 pt-8 flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => router.push("/majors/fantasy")}
          className="text-[11px] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
        >
          ← Wallets
        </button>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-[11px] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
        >
          Home
        </button>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={refreshingAll}
              className="text-[10px] text-[color:var(--sec-muted)] border border-[color:var(--sec-hair)] rounded-full px-2 py-0.5 hover:text-[color:var(--sec-text)] disabled:opacity-50"
              title="Rebuild all player profiles and re-price every event + season"
            >
              {refreshingAll ? "Refreshing…" : "⟳ Refresh all"}
            </button>
          )}
          <OddsFormatMenu />
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[color:var(--sec-muted)] text-center py-20">Loading…</div>
      ) : !group ? (
        <div className="px-4 py-20 text-center text-sm text-[color:var(--sec-muted)]">Group not found.</div>
      ) : (
        <div className="px-4 pb-8 space-y-5">
          {/* Wallet header */}
          <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-gradient-to-br from-[color:color-mix(in_srgb,var(--sec-surface)_90%,transparent)] to-[color:color-mix(in_srgb,var(--sec-surface)_90%,transparent)] px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-[color:var(--sec-accent)] truncate">{group.group.name}</h1>
                <div className="text-[10px] text-[color:var(--sec-muted)] mt-0.5">
                  {group.config.mode === "topup" ? "Top-up" : "Fixed"} ·{" "}
                  {group.config.budgetScope === "event" ? "per event" : "per season"}
                </div>
              </div>
              <div className="text-right shrink-0">
                {group.balance !== null && (
                  <div className="text-base font-bold text-[color:var(--sec-accent)]">{formatPoints(group.balance)} pts</div>
                )}
                {group.config.mode === "topup" && (
                  <button
                    type="button"
                    onClick={() => setTopupOpen(true)}
                    className="text-[11px] font-semibold text-[color:var(--sec-good)] hover:text-[color:var(--sec-good)]"
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
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)] mb-2">
                Season · {season.seasonName}
              </h2>
              <button
                type="button"
                onClick={() => router.push(`/majors/fantasy/seasons/${season.seasonId}`)}
                className="w-full text-left rounded-2xl border border-[color:color-mix(in_srgb,var(--sec-accent)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] px-3.5 py-3 hover:bg-[color:var(--sec-surface-2)] transition-colors"
              >
                <PreviewTable model={season.preview} />
                <div className="mt-1.5 text-right text-[11px] font-semibold text-[color:var(--sec-good)]">Markets →</div>
              </button>
            </section>
          )}

          {/* Events coupon */}
          <section>
            <h2 className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)] mb-2">Events</h2>
            {sortedEvents.length === 0 ? (
              <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_80%,transparent)] px-4 py-5 text-center text-sm text-[color:var(--sec-muted)]">
                No upcoming events.
              </div>
            ) : (
              <div className="space-y-2">
                {sortedEvents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => router.push(`/majors/fantasy/events/${e.id}`)}
                    className="w-full text-left rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] px-3.5 py-3 hover:bg-[color:var(--sec-surface-2)] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[color:var(--sec-text)] truncate">{e.name}</div>
                        <div className="text-[10px] text-[color:var(--sec-muted)] mt-0.5">
                          {e.event_date
                            ? new Date(e.event_date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
                            : "Date TBC"}
                          {e.majors_status === "live" && " · LIVE"}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] font-semibold ${
                          e.has_markets ? "text-[color:var(--sec-good)]" : "text-[color:var(--sec-muted)]"
                        }`}
                      >
                        {e.has_markets ? "Markets →" : "Soon"}
                      </span>
                    </div>
                    {e.narrative && (
                      <div className="mt-2 pt-2 border-t border-[color:var(--sec-hair)]">
                        <div className="text-[8px] uppercase tracking-[0.2em] text-[color:color-mix(in_srgb,var(--sec-accent)_55%,transparent)] mb-0.5">
                          Preview
                        </div>
                        <p className="text-[11px] leading-snug text-[color:var(--sec-muted)] line-clamp-2">
                          {e.narrative}
                        </p>
                      </div>
                    )}
                    {e.preview && (
                      <div className="mt-2 pt-2 border-t border-[color:var(--sec-hair)]">
                        <PreviewTable model={e.preview} />
                      </div>
                    )}
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
            <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              <div className="text-sm font-bold text-[color:var(--sec-accent)] mb-1">Top up wallet</div>
              <div className="text-[11px] text-[color:var(--sec-muted)] mb-4">
                {formatPoints(group?.config.topupIncrement ?? 0)} pts per unit. Top-ups don&apos;t count toward PnL.
              </div>
              <div className="flex items-center justify-center gap-5 mb-4">
                <button type="button" onClick={() => setTopupUnits((u) => Math.max(1, u - 1))} className="h-10 w-10 rounded-full border border-[color:var(--sec-hair)] text-[color:var(--sec-text-2)] text-lg">−</button>
                <div className="text-center min-w-[90px]">
                  <div className="text-2xl font-bold text-[color:var(--sec-text)]">{formatPoints(topupUnits * (group?.config.topupIncrement ?? 0))}</div>
                  <div className="text-[10px] text-[color:var(--sec-muted)]">points</div>
                </div>
                <button type="button" onClick={() => setTopupUnits((u) => Math.min(100, u + 1))} className="h-10 w-10 rounded-full border border-[color:var(--sec-hair)] text-[color:var(--sec-text-2)] text-lg">+</button>
              </div>
              <button type="button" onClick={handleTopUp} disabled={toppingUp} className="w-full py-2.5 rounded-full bg-[color:var(--sec-primary)] text-sm font-semibold text-white hover:bg-[color:var(--sec-primary-hover)] disabled:opacity-50">
                {toppingUp ? "Topping up…" : "Confirm top-up"}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

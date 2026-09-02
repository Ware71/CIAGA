"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import type { MajorHubSummary, MajorGroupSeasonStats, EventWithGroup } from "@/lib/majors/types";
import { eventStatusLabel } from "@/lib/majors/labels";
import { MAJORS_CARD, MAJORS_CARD_INTERACTIVE, MajorsSection } from "./majorsChrome";

/**
 * The rich Majors surface — purse, season snapshot, live and upcoming events.
 *
 * This used to be the swipe-up face of the home screen (components/home/MajorsView),
 * which was strictly richer than the real /majors route while being unreachable by
 * URL. With Majors promoted to a nav tab, the two collapsed into one: /majors renders
 * these pieces above its own invitations and group lists.
 *
 * Group grids deliberately did NOT come across — MajorsHubClient already renders
 * groups with working join/request actions, which the cards here lacked.
 */

function fmtPts(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(Math.round(n));
}

function CompetitionCard({ comp }: { comp: EventWithGroup }) {
  const router = useRouter();
  const isLive = comp.majors_status === "live";
  const isCompleted = comp.majors_status === "completed";

  return (
    <button
      type="button"
      onClick={() => router.push(`/majors/events/${comp.id}?from=home`)}
      className={`${MAJORS_CARD_INTERACTIVE} relative w-full overflow-hidden p-3.5 pl-4 text-left space-y-1.5`}
      style={
        // Live and completed keep their status hue on the edge; everything else
        // inherits the section's gold so the stack reads as one set.
        isLive
          ? { borderColor: "rgba(217,119,6,0.45)" }
          : isCompleted
            ? { borderColor: "rgba(52,211,153,0.30)" }
            : undefined
      }
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{
          background: isLive
            ? "linear-gradient(to bottom, #d97706, #92400e)"
            : isCompleted
            ? "#065f46"
            : "transparent",
        }}
      />
      <div className="pl-2">
        {comp.group && (
          <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-200/55 mb-0.5">
            {comp.group.name}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-emerald-50 leading-snug truncate">{comp.name}</span>
          <span
            className={`shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full capitalize border ${
              isLive
                ? "bg-amber-900/50 text-amber-300 border-amber-800/50"
                : isCompleted
                ? "bg-emerald-900/60 text-emerald-300 border-emerald-800/50"
                : "bg-emerald-900/40 text-emerald-200/70 border-emerald-900/60"
            }`}
          >
            {eventStatusLabel(comp)}
          </span>
        </div>
        <div className="text-[10px] text-emerald-100/60 flex items-center gap-2">
          {comp.event_date && (
            <span>{new Date(comp.event_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
          )}
          {comp.course && (
            <>
              <span className="text-emerald-800">·</span>
              <span className="truncate">{comp.course.name}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

type Transaction = { id: string; type: string; amount: number; note: string | null };
type GroupBalance = {
  group_id: string;
  group_name: string;
  balance: number;
  by_event: { event_id: string | null; event_name: string | null; net: number; transactions: Transaction[] }[];
};
type BalanceData = {
  total_balance: number;
  has_debt: boolean;
  groups: GroupBalance[];
};

function PurseIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M20 12V22H4V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 7H2v5h20V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 22V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function fmtAbs(n: number) { return `£${Math.abs(n).toFixed(2)}`; }
function fmtSigned(n: number) { return n > 0 ? `-${fmtAbs(n)}` : `+${fmtAbs(n)}`; }
function humaniseType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function isPrize(type: string) {
  return type.toLowerCase().includes("prize") || type.toLowerCase().includes("winning");
}

function BalanceDrawer({ balance, onClose }: { balance: BalanceData; onClose: () => void }) {
  const debtGroups = balance.groups.filter((g) => g.balance > 0);
  const creditGroups = balance.groups.filter((g) => g.balance < 0);

  const totalDisplay = balance.total_balance === 0
    ? <span className="text-lg font-bold text-emerald-400">Settled</span>
    : balance.has_debt
    ? <span className="text-lg font-bold text-red-400">owe {fmtSigned(balance.total_balance)}</span>
    : <span className="text-lg font-bold text-emerald-400">{fmtSigned(balance.total_balance)}</span>;

  const content = (
    <div className="fixed inset-0 z-[200]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="absolute left-0 right-0 bottom-0 rounded-t-3xl border-t border-emerald-900/70 bg-[#061f12] max-h-[85dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mt-3 mb-1" />
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm font-semibold text-emerald-50">Your Balance</div>
          <button type="button" onClick={onClose} className="text-emerald-200/60 hover:text-emerald-100 text-lg leading-none">✕</button>
        </div>

        {/* Total summary */}
        <div className="mx-4 mb-3 rounded-2xl border bg-[#0b3b21]/80 p-4 flex items-center justify-between"
          style={{ borderColor: balance.has_debt ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)" }}>
          <div className="text-[11px] uppercase tracking-widest text-emerald-200/50">Total</div>
          {totalDisplay}
        </div>

        <div className="px-4 pb-4 space-y-3">
          {/* Debts first */}
          {debtGroups.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-red-400/70 font-semibold">You Owe</div>
              {debtGroups.map((g) => (
                <div key={g.group_id} className="rounded-2xl border border-red-900/30 bg-red-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-emerald-50 truncate">{g.group_name}</span>
                    <span className="text-sm font-bold text-red-400 shrink-0 ml-2">owe {fmtSigned(g.balance)}</span>
                  </div>
                  {g.by_event.filter((e) => e.net !== 0).map((e, i) => (
                    <div key={e.event_id ?? i} className="pl-1 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-emerald-200/70 truncate font-medium">{e.event_name ?? "General"}</span>
                        <span className={`shrink-0 ml-2 font-semibold ${e.net > 0 ? "text-red-400/80" : "text-emerald-400/80"}`}>
                          {fmtSigned(e.net)}
                        </span>
                      </div>
                      {(e.transactions ?? []).map((tx) => (
                        <div key={tx.id} className="flex items-center justify-between text-[10px] pl-2">
                          <span className="text-emerald-200/50 truncate flex items-center gap-1.5">
                            {tx.note || humaniseType(tx.type)}
                            {isPrize(tx.type) && tx.amount < 0 && (
                              <span className="text-[9px] font-semibold text-emerald-300 border border-emerald-700/50 rounded-full px-1.5 py-0.5 leading-none">won</span>
                            )}
                          </span>
                          <span className={`shrink-0 ml-2 ${tx.amount > 0 ? "text-red-400/70" : "text-emerald-400/70"}`}>
                            {fmtSigned(tx.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Credits */}
          {creditGroups.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-emerald-400/70 font-semibold">In Credit</div>
              {creditGroups.map((g) => (
                <div key={g.group_id} className="rounded-2xl border border-emerald-800/30 bg-emerald-950/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-emerald-50 truncate">{g.group_name}</span>
                    <span className="text-sm font-bold text-emerald-400 shrink-0 ml-2">{fmtSigned(g.balance)}</span>
                  </div>
                  {g.by_event.filter((e) => e.net !== 0).map((e, i) => (
                    <div key={e.event_id ?? i} className="pl-1 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-emerald-200/70 truncate font-medium">{e.event_name ?? "General"}</span>
                        <span className={`shrink-0 ml-2 font-semibold ${e.net > 0 ? "text-red-400/80" : "text-emerald-400/80"}`}>
                          {fmtSigned(e.net)}
                        </span>
                      </div>
                      {(e.transactions ?? []).map((tx) => (
                        <div key={tx.id} className="flex items-center justify-between text-[10px] pl-2">
                          <span className="text-emerald-200/50 truncate flex items-center gap-1.5">
                            {tx.note || humaniseType(tx.type)}
                            {isPrize(tx.type) && tx.amount < 0 && (
                              <span className="text-[9px] font-semibold text-emerald-300 border border-emerald-700/50 rounded-full px-1.5 py-0.5 leading-none">won</span>
                            )}
                          </span>
                          <span className={`shrink-0 ml-2 ${tx.amount > 0 ? "text-red-400/70" : "text-emerald-400/70"}`}>
                            {fmtSigned(tx.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {balance.groups.length === 0 && (
            <div className="text-xs text-emerald-200/40 text-center py-6">No balance activity yet</div>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

function MajorsSnapshotInner({ initialHub }: { initialHub?: MajorHubSummary | null }) {
  const router = useRouter();
  const [hub, setHub] = useState<MajorHubSummary | null>(initialHub ?? null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Sync if the parent finishes preloading after we already mounted
  useEffect(() => {
    if (initialHub) setHub(initialHub);
  }, [initialHub]);

  useEffect(() => {
    if (initialHub) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await requireViewerSession();
        if (!session || cancelled) return;
        const res = await fetch("/api/majors/hub", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setHub(data);
        }
      } catch {
        // silently ignore — this is a preview
      }
    })();
    return () => { cancelled = true; };
  }, [initialHub]);

  return (
    <div className="w-full space-y-3">
      {/* Season snapshot */}
      {hub && (
        <>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={`${MAJORS_CARD_INTERACTIVE} w-full p-4 text-left`}
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7CF0BE]/80">
                Season
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-[#7CF0BE]/30 to-transparent" />
              <div className="shrink-0 text-xs text-[#7CF0BE]/50">›</div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Events", value: hub.season_events },
                { label: "Rounds", value: hub.season_rounds_played },
                { label: "Wins", value: hub.season_wins },
                { label: "Earnings", value: hub.season_earnings === 0 ? "—" : `£${hub.season_earnings.toFixed(0)}` },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-2xl font-extrabold leading-none text-[#7CF0BE] tabular-nums">
                    {stat.value}
                  </div>
                  <div className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-200/50">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </button>
          {drawerOpen && <SeasonStatsDrawer hub={hub} onClose={() => setDrawerOpen(false)} />}
        </>
      )}

      {/* Live events */}
      {hub && hub.active_events.length > 0 && (
        <MajorsSection
          title="Live Now"
          action={<span className="block h-1.5 w-1.5 rounded-full bg-amber-400" />}
        >
          <div className="space-y-2">
            {hub.active_events.slice(0, 2).map((comp) => (
              <CompetitionCard key={comp.id} comp={comp} />
            ))}
          </div>
        </MajorsSection>
      )}

      {/* Upcoming events */}
      {hub && hub.active_events.length === 0 && hub.upcoming_events.length > 0 && (
        <MajorsSection title="Upcoming">
          <div className="space-y-2">
            {hub.upcoming_events.slice(0, 2).map((comp) => (
              <CompetitionCard key={comp.id} comp={comp} />
            ))}
          </div>
        </MajorsSection>
      )}

    </div>
  );
}

function AllTimeVsSeasonSection({ hub }: { hub: MajorHubSummary }) {
  const fmt = (n: number) => (n === 0 ? "—" : `£${n.toFixed(2)}`);
  const rows = [
    { label: "Events",   season: hub.season_events,        alltime: hub.alltime_events,        isCurrency: false },
    { label: "Rounds",   season: hub.season_rounds_played,  alltime: hub.alltime_rounds_played,  isCurrency: false },
    { label: "Wins",     season: hub.season_wins,           alltime: hub.alltime_wins,           isCurrency: false },
    { label: "Earnings", season: hub.season_earnings,       alltime: hub.alltime_earnings,       isCurrency: true  },
  ];
  return (
    <div className="mx-4 rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/60 overflow-hidden">
      <div className="grid grid-cols-3 text-[10px] uppercase tracking-[0.14em] text-emerald-200/50 px-3 pt-3 pb-1">
        <div />
        <div className="text-center text-emerald-300/80 font-semibold">Season</div>
        <div className="text-center">All Time</div>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-3 px-3 py-2 border-t border-emerald-900/40">
          <div className="text-[11px] text-emerald-200/60 self-center">{row.label}</div>
          <div className="text-center text-sm font-bold text-[#7CF0BE]">
            {row.isCurrency ? fmt(row.season) : (row.season || "—")}
          </div>
          <div className="text-center text-sm font-semibold text-emerald-100/80">
            {row.isCurrency ? fmt(row.alltime) : (row.alltime || "—")}
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupStatRow({ stat }: { stat: MajorGroupSeasonStats }) {
  const fmt = (n: number) => (n === 0 ? "—" : `£${n.toFixed(2)}`);
  const stats = [
    { label: "Events",   value: stat.events || "—" },
    { label: "Rounds",   value: stat.rounds_played || "—" },
    { label: "Wins",     value: stat.wins || "—" },
    { label: "Earnings", value: fmt(stat.earnings) },
    { label: "Points",   value: stat.season_points ? fmtPts(stat.season_points) : "—" },
  ];
  return (
    <div className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/60 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        {stat.group_image_url ? (
          <img             src={stat.group_image_url}
            alt={stat.group_name}
            className="h-6 w-6 rounded-full object-cover border border-emerald-700/40 shrink-0" loading="lazy" decoding="async" />
        ) : (
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-[9px] font-bold text-emerald-200 shrink-0">
            {stat.group_name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className="text-xs font-semibold text-emerald-50 truncate">{stat.group_name}</span>
        {stat.season_rank != null && (
          <span className="ml-auto shrink-0 text-[9px] text-emerald-300/60 border border-emerald-800/50 rounded-full px-1.5 py-0.5">
            #{stat.season_rank}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-2 text-center">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-sm font-bold text-emerald-50">{s.value}</div>
            <div className="text-[9px] text-emerald-200/50 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeasonStatsDrawer({ hub, onClose }: { hub: MajorHubSummary; onClose: () => void }) {
  const content = (
    <div className="fixed inset-0 z-[200]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="absolute left-0 right-0 bottom-0 rounded-t-3xl border-t border-emerald-900/70 bg-[#061f12] max-h-[85dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 16px)" }}
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mt-3 mb-1" />
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm font-semibold text-emerald-50">Your Stats</div>
          <button
            type="button"
            onClick={onClose}
            className="text-emerald-200/60 hover:text-emerald-100 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <AllTimeVsSeasonSection hub={hub} />

        <div className="mx-4 border-t border-emerald-900/50 my-3" />

        <div className="px-4 pb-4 space-y-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#7CF0BE]/75 mb-2">
            By Group · Season
          </div>
          {hub.group_stats.length === 0 ? (
            <div className="text-xs text-emerald-200/40 text-center py-4">Join a group to see per-group stats</div>
          ) : (
            hub.group_stats.map((g) => <GroupStatRow key={g.group_id} stat={g} />)
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}


/** Season snapshot, Live Now and Upcoming. Self-fetches when no hub is supplied. */
export function MajorsSnapshot({ initialHub }: { initialHub?: MajorHubSummary | null }) {
  return <MajorsSnapshotInner initialHub={initialHub} />;
}

/** Purse button plus its drawer, for the hub header. */
export function MajorsBalance() {
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [balanceDrawerOpen, setBalanceDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await requireViewerSession();
        if (!session || cancelled) return;
        const res = await fetch("/api/majors/balance", {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (res.ok && !cancelled) setBalanceData(await res.json());
      } catch {
        // Silently ignore — the purse is supplementary.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => balanceData && setBalanceDrawerOpen(true)}
        className="relative flex items-center gap-1.5 h-10 shrink-0"
        aria-label="My balance"
      >
        <div className="relative">
          <PurseIcon size={24} className="text-emerald-300/70" />
          {balanceData?.has_debt && (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500 border border-[#042713]" />
          )}
        </div>
        {balanceData != null && (
          <span
            className={`text-[11px] font-semibold ${
              balanceData.has_debt ? "text-red-400" : "text-emerald-300/70"
            }`}
          >
            {balanceData.total_balance === 0 ? "£0" : fmtSigned(balanceData.total_balance)}
          </span>
        )}
      </button>
      {balanceDrawerOpen && balanceData && (
        <BalanceDrawer balance={balanceData} onClose={() => setBalanceDrawerOpen(false)} />
      )}
    </>
  );
}

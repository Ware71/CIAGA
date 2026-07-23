"use client";

import { useRef, useState, useCallback, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { AuthUser } from "@/components/ui/auth-user";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import type { MajorHubSummary, MajorGroupSeasonStats, MajorGroup, EventWithGroup } from "@/lib/majors/types";
import { eventStatusLabel } from "@/lib/majors/labels";

type MenuItem = { id: string; label: string };

function fmtPts(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(Math.round(n));
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

type MajorsViewProps = {
  open: boolean;
  setOpen: (fn: (prev: boolean) => boolean) => void;
  goToHome: () => void;
  majorsMenuItems: MenuItem[];
  handleMajorsSelect: (id: string) => void;
  renderRadialMenu: (items: MenuItem[], onSelect: (id: string) => void) => React.ReactNode;
  vh: number;
  initialHub?: MajorHubSummary | null;
};

function CompetitionCard({ comp }: { comp: EventWithGroup }) {
  const router = useRouter();
  const isLive = comp.majors_status === "live";
  const isCompleted = comp.majors_status === "completed";

  return (
    <button
      type="button"
      onClick={() => router.push(`/majors/events/${comp.id}?from=home`)}
      className="w-full text-left rounded-2xl border bg-[#0b3b21]/80 p-3.5 space-y-1.5 overflow-hidden relative"
      style={{
        borderColor: isLive ? "rgba(217,119,6,0.35)" : isCompleted ? "rgba(52,211,153,0.25)" : "rgba(6,78,59,0.7)",
      }}
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

function GroupCard({ group, onClick }: { group: MajorGroup & { member_count: number }; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-3 space-y-2 hover:border-emerald-700/70 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        {group.image_url ? (
          <img src={group.image_url} alt={group.name} className="h-9 w-9 rounded-full object-cover border border-emerald-700/40 shrink-0" loading="lazy" decoding="async" />
        ) : (
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-[11px] font-bold text-emerald-200 shrink-0">
            {group.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-emerald-50 truncate leading-tight">{group.name}</div>
          <div className="text-[10px] text-emerald-100/50 capitalize">{group.type.replace(/_/g, " ")}</div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-emerald-200/55">{group.member_count} member{group.member_count !== 1 ? "s" : ""}</span>
        {group.ciaga_tag !== "none" && (
          <span className="text-amber-300/70 capitalize border border-amber-800/30 rounded-full px-1.5 py-0.5">{group.ciaga_tag}</span>
        )}
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

function MajorsHubPreview({ open, initialHub }: { open: boolean; initialHub?: MajorHubSummary | null }) {
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
    <motion.div
      className="w-full mt-24 space-y-3"
      initial={false}
      animate={{
        opacity: open ? 0.25 : 1,
        scale: open ? 0.995 : 1,
      }}
      transition={{ duration: 0.18 }}
      style={{
        filter: open ? "blur(2px)" : "blur(0px)",
        pointerEvents: open ? "none" : "auto",
      }}
    >
      {/* Season snapshot */}
      {hub && (
        <>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 active:opacity-80 transition-opacity"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65">Season</div>
              <div className="text-emerald-400/60 text-xs">›</div>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Events", value: hub.season_events },
                { label: "Rounds", value: hub.season_rounds_played },
                { label: "Wins", value: hub.season_wins },
                { label: "Earnings", value: hub.season_earnings === 0 ? "—" : `£${hub.season_earnings.toFixed(0)}` },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-xl font-extrabold text-[#f5e6b0] leading-none">{stat.value}</div>
                  <div className="text-[10px] text-emerald-200/55 mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
          </button>
          {drawerOpen && <SeasonStatsDrawer hub={hub} onClose={() => setDrawerOpen(false)} />}
        </>
      )}

      {/* Live events */}
      {hub && hub.active_events.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            Live Now
          </div>
          {hub.active_events.slice(0, 2).map((comp) => (
            <CompetitionCard key={comp.id} comp={comp} />
          ))}
        </div>
      )}

      {/* Upcoming events */}
      {hub && hub.active_events.length === 0 && hub.upcoming_events.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">Upcoming</div>
          {hub.upcoming_events.slice(0, 2).map((comp) => (
            <CompetitionCard key={comp.id} comp={comp} />
          ))}
        </div>
      )}

      {/* My Groups */}
      {hub && hub.my_groups.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">My Groups</div>
            <button
              type="button"
              onClick={() => router.push("/majors/groups/create")}
              className="text-[10px] text-emerald-400 hover:text-emerald-300 shrink-0"
            >
              + New
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {hub.my_groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                onClick={() => router.push(`/majors/groups/${g.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Discover Groups */}
      {hub && hub.discover_groups.length > 0 && (
        <div className="space-y-1.5 pb-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">Discover Groups</div>
          <div className="grid grid-cols-2 gap-2">
            {hub.discover_groups.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                onClick={() => router.push(`/majors/groups/${g.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {(!hub || (hub.my_groups.length === 0 && hub.active_events.length === 0 && hub.upcoming_events.length === 0)) && (
        <>
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <h2 className="text-sm font-semibold text-emerald-50 mb-1">CIAGA Majors</h2>
            <p className="text-[11px] text-emerald-100/75">
              Create groups, run competitions, and track season standings. Tap Hub to get started.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/majors/groups/create")}
            className="w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-sm font-semibold text-emerald-200 text-left hover:border-emerald-700/70"
          >
            + Create your first group →
          </button>
        </>
      )}
    </motion.div>
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
          <div className="text-center text-sm font-bold text-[#f5e6b0]">
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
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55 mb-2">
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

export function MajorsView({
  open,
  setOpen,
  goToHome,
  majorsMenuItems,
  handleMajorsSelect,
  renderRadialMenu,
  vh,
  initialHub,
}: MajorsViewProps) {
  const majorsHeaderAnchorRef = useRef<HTMLDivElement | null>(null);
  const [majorsClosedY, setMajorsClosedY] = useState<number | null>(null);
  const [majorsFallbackY, setMajorsFallbackY] = useState<number>(-200);
  const majorsNudge = clamp(vh * 0.018, 8, 20);

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
        // silently ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const computeMajorsClosedY = useCallback(() => {
    const el = majorsHeaderAnchorRef.current;
    if (!el || typeof window === "undefined") return;

    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height === 0) return;

    const anchorCenterY = rect.top + rect.height / 2;
    const viewportCenterY = (window.visualViewport?.height ?? window.innerHeight) / 2;

    const y = anchorCenterY - viewportCenterY;
    if (Number.isFinite(y)) setMajorsClosedY(y);
  }, []);

  useLayoutEffect(() => {
    setMajorsClosedY(null);

    const h = window.visualViewport?.height ?? window.innerHeight;
    setMajorsFallbackY(-(h / 2) + h * 0.09);

    const el = majorsHeaderAnchorRef.current;
    if (!el) return;

    const run = () => computeMajorsClosedY();

    const raf = requestAnimationFrame(() => requestAnimationFrame(run));
    const t1 = window.setTimeout(run, 50);
    const t2 = window.setTimeout(run, 200);

    const onResize = () => run();
    window.addEventListener("resize", onResize);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => run());
      ro.observe(el);
    }

    (document as any)?.fonts?.ready?.then?.(() => run());

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onResize);
    };
  }, [computeMajorsClosedY]);

  return (
    <motion.div
      key="majors"
      className="min-h-screen bg-[#042713] text-slate-100 flex flex-col items-center pb-[env(safe-area-inset-bottom)] pt-8 px-4 overflow-visible"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.22 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 160 }}
      dragElastic={0.2}
      onDragEnd={(_, info) => {
        if (info.offset.y > 80 || info.velocity.y > 500) {
          goToHome();
        }
      }}
    >
      <header className="w-full max-w-sm flex items-center justify-between relative z-50 overflow-visible">
        {/* Purse / balance button */}
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
            <span className={`text-[11px] font-semibold ${balanceData.has_debt ? "text-red-400" : "text-emerald-300/70"}`}>
              {balanceData.total_balance === 0
                ? "£0"
                : fmtSigned(balanceData.total_balance)}
            </span>
          )}
        </button>

        <div
          ref={majorsHeaderAnchorRef}
          className="absolute left-1/2 top-1/2 z-0"
          style={{
            width: 80,
            height: 80,
            opacity: 0,
            pointerEvents: "none",
            transform: `translate(-50%, -50%) translateY(${majorsNudge}px)`,
          }}
        />

        <div className="relative z-50 overflow-visible pointer-events-auto scale-[1.4] origin-top-right -translate-y-[4px]">
          <AuthUser />
        </div>
      </header>
      {balanceDrawerOpen && balanceData && (
        <BalanceDrawer balance={balanceData} onClose={() => setBalanceDrawerOpen(false)} />
      )}

      <div className="relative flex-1 w-full max-w-sm">
        {renderRadialMenu(majorsMenuItems, handleMajorsSelect)}

        <motion.div
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center"
          initial={false}
          animate={{
            y: open ? 0 : majorsClosedY ?? majorsFallbackY,
            opacity: 1,
          }}
          transition={{ type: "spring", stiffness: 180, damping: 18 }}
        >
          <motion.button
            className="h-20 w-20 rounded-full bg-transparent grid place-items-center"
            onClick={() => setOpen((prev) => !prev)}
            whileTap={{ scale: 0.92 }}
            initial={false}
            animate={{ rotate: open ? 360 : 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
          >
            <motion.div
              className="h-[72px] w-[72px] rounded-full overflow-hidden flex items-center justify-center"
              animate={{ scale: open ? 1.05 : 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 18 }}
            >
              <Image src="/ciaga-logo.png" alt="CIAGA logo" width={72} height={72} className="object-contain" />
            </motion.div>
          </motion.button>

          <div className="mt-2 text-xs tracking-[0.18em] uppercase text-emerald-200/80">Majors</div>
        </motion.div>

        <MajorsHubPreview open={open} initialHub={initialHub} />
      </div>
    </motion.div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import type {
  SeasonFinancialSummary,
  PrizePotWithDetails,
  PrizePotDistributionType,
} from "@/lib/majors/types";

type Tab = "schedule" | "standings" | "finances";

type GroupSeason = {
  id: string;
  group_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  season_label: string | null;
  standings_model: string;
  group: { id: string; name: string; type: string } | null;
};

type SeasonEvent = {
  id: string;
  name: string;
  event_date: string | null;
  majors_status: string;
  competition_id: string | null;
  competition: { id: string; name: string } | null;
};

type StandingRow = {
  profile_id: string;
  position: number | null;
  season_points: number;
  events_played: number;
  wins: number;
  top_3s: number;
  best_finish: number | null;
  total_gross: number | null;
  total_net: number | null;
  avg_gross_to_par: number | null;
  avg_net_to_par: number | null;
  profile: { id: string; name: string | null; avatar_url: string | null } | null;
};

const statusColour = (status: string) =>
  status === "live"
    ? "bg-amber-900/50 text-amber-300"
    : status === "completed" || status === "official"
    ? "bg-emerald-900/60 text-emerald-300"
    : status === "cancelled"
    ? "bg-red-900/40 text-red-400"
    : "bg-emerald-900/40 text-emerald-200/70";

export default function GroupSeasonDetailClient({ groupSeasonId }: { groupSeasonId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("schedule");
  const [season, setSeason] = useState<GroupSeason | null>(null);
  const [events, setEvents] = useState<SeasonEvent[]>([]);
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [financials, setFinancials] = useState<SeasonFinancialSummary | null>(null);
  const [financialsError, setFinancialsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seasonPots, setSeasonPots] = useState<PrizePotWithDetails[]>([]);
  const [potError, setPotError] = useState<string | null>(null);
  const [addPotForm, setAddPotForm] = useState<{
    name: string; description: string; distribution_type: PrizePotDistributionType | "winner_takes_all";
    entry_fee_amount: string; entry_fee_notes: string; is_monetary: boolean; prize_description: string;
  } | null>(null);
  const [addingPot, setAddingPot] = useState(false);
  const [expandedPotId, setExpandedPotId] = useState<string | null>(null);
  const [potActionLoading, setPotActionLoading] = useState<string | null>(null);
  const [proposedDist, setProposedDist] = useState<{
    potId: string;
    total_pot: number;
    proposed: Array<{ profile_id: string; profile: { name: string | null } | null; position: number | null; amount: number | null; note: string }>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await requireViewerSession();
        if (!session || cancelled) return;
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [seasonRes, standingsRes] = await Promise.all([
          fetch(`/api/majors/group-seasons/${groupSeasonId}`, { headers }),
          fetch(`/api/majors/group-seasons/${groupSeasonId}/standings`, { headers }),
        ]);

        if (cancelled) return;

        if (seasonRes.ok) {
          const j = await seasonRes.json();
          setSeason(j.season);
          setEvents(j.events ?? []);
        }
        if (standingsRes.ok) {
          const j = await standingsRes.json();
          setStandings(j.standings ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupSeasonId]);

  useEffect(() => {
    if (tab !== "finances") return;
    let cancelled = false;
    (async () => {
      setFinancialsError(null);
      const session = await requireViewerSession();
      if (!session || cancelled) return;
      const headers = { Authorization: `Bearer ${session.accessToken}` };
      const [res, potsRes] = await Promise.all([
        fetch(`/api/majors/group-seasons/${groupSeasonId}/financials`, { headers }),
        fetch(`/api/majors/group-seasons/${groupSeasonId}/prize-pots`, { headers }),
      ]);
      if (cancelled) return;
      if (res.ok) {
        const j = await res.json();
        setFinancials(j);
      } else {
        const j = await res.json().catch(() => ({}));
        setFinancialsError(j.error ?? "Failed to load financials");
      }
      if (potsRes.ok) {
        const j = await potsRes.json();
        setSeasonPots(j.pots ?? []);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, groupSeasonId]);

  const refreshPots = async () => {
    const session = await requireViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/group-seasons/${groupSeasonId}/prize-pots`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) { const j = await res.json(); setSeasonPots(j.pots ?? []); }
  };

  const handleAddPot = async () => {
    if (!addPotForm || !addPotForm.name.trim()) return;
    setAddingPot(true); setPotError(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/group-seasons/${groupSeasonId}/prize-pots`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addPotForm.name.trim(),
          description: addPotForm.description.trim() || null,
          distribution_type: addPotForm.distribution_type === "winner_takes_all" ? "position_based" : addPotForm.distribution_type,
          prize_table: addPotForm.distribution_type === "winner_takes_all" ? [{ position: 1, pct: 100 }] : null,
          entry_fee_amount: addPotForm.entry_fee_amount ? parseFloat(addPotForm.entry_fee_amount) : null,
          entry_fee_notes: addPotForm.entry_fee_notes.trim() || null,
          is_monetary: addPotForm.is_monetary,
          prize_description: addPotForm.prize_description.trim() || null,
        }),
      });
      if (!res.ok) { const j = await res.json(); setPotError(j.error ?? "Failed to create pot"); return; }
      setAddPotForm(null);
      await refreshPots();
    } finally { setAddingPot(false); }
  };

  const handleProposeDist = async (potId: string) => {
    setPotActionLoading(potId + ":propose"); setPotError(null); setProposedDist(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/prize-pots/${potId}/distribute`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: false }),
      });
      const j = await res.json();
      if (!res.ok) { setPotError(j.error ?? "Failed to propose"); return; }
      setProposedDist({ potId, total_pot: j.total_pot, proposed: j.proposed });
    } finally { setPotActionLoading(null); }
  };

  const handleConfirmDist = async (potId: string) => {
    setPotActionLoading(potId + ":confirm"); setPotError(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/prize-pots/${potId}/distribute`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const j = await res.json();
      if (!res.ok) { setPotError(j.error ?? "Failed to confirm"); return; }
      setProposedDist(null);
      await refreshPots();
    } finally { setPotActionLoading(null); }
  };

  const handleDeletePot = async (potId: string) => {
    setPotActionLoading(potId + ":delete"); setPotError(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/prize-pots/${potId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) { const j = await res.json(); setPotError(j.error ?? "Failed to delete pot"); return; }
      if (expandedPotId === potId) setExpandedPotId(null);
      await refreshPots();
    } finally { setPotActionLoading(null); }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-sm text-emerald-100/60">Loading…</div>
      </div>
    );
  }

  if (!season) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-sm text-emerald-100/60">Season not found.</div>
        <button type="button" onClick={() => router.back()} className="text-sm text-emerald-200 underline">Go back</button>
      </div>
    );
  }

  const inputCls = "w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600";
  const distTypeLabel: Record<string, string> = {
    season_standings_winner: "Season Standings Winner",
    winner_takes_all: "Winner Takes All",
    position_based: "By Finishing Position",
    metric_weighted: "Proportional to Metric",
    metric_equal: "Equal Split (Qualifiers)",
    equal_split: "Equal Split (All Players)",
    non_monetary: "Non-Cash Prize",
    entry_only: "Entry Only",
  };
  const potStatusColour: Record<string, string> = {
    active: "text-emerald-400 bg-emerald-900/30 border-emerald-700/40",
    locked: "text-yellow-300 bg-yellow-900/20 border-yellow-700/40",
    distributed: "text-blue-300 bg-blue-900/20 border-blue-700/40",
  };

  // Group events by competition for the schedule tab
  const competitionMap = new Map<string | null, { name: string | null; events: SeasonEvent[] }>();
  for (const ev of events) {
    const key = ev.competition_id ?? null;
    if (!competitionMap.has(key)) {
      competitionMap.set(key, { name: ev.competition?.name ?? "Standalone Events", events: [] });
    }
    competitionMap.get(key)!.events.push(ev);
  }

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center justify-between mb-3">
        <button type="button" onClick={() => router.back()} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Back
        </button>
        <div className="w-14" />
      </div>

      {/* Hero */}
      <div className="px-4 mb-4 space-y-1">
        {season.group && (
          <button
            type="button"
            onClick={() => router.push(`/majors/groups/${season.group!.id}`)}
            className="inline-flex items-center text-[10px] uppercase tracking-wider text-emerald-200/55 hover:text-emerald-200 border border-emerald-900/50 rounded-full px-2.5 py-1 transition-colors"
          >
            {season.group.name}
          </button>
        )}
        <h1 className="text-xl font-bold text-[#f5e6b0] leading-tight">{season.name}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full capitalize ${statusColour(season.status)}`}>
            {season.status}
          </span>
          <span className="text-[11px] text-emerald-100/60">
            {new Date(season.start_date).toLocaleDateString([], { month: "short", year: "numeric" })} –{" "}
            {new Date(season.end_date).toLocaleDateString([], { month: "short", year: "numeric" })}
          </span>
          <span className="text-[10px] text-emerald-200/40">{events.length} event{events.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="overflow-x-auto px-4 mb-5">
        <div className="flex gap-2">
          {(["schedule", "standings", "finances"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors capitalize ${
                tab === t
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-8">
        {tab === "schedule" && (
          <div className="space-y-4">
            {events.length === 0 ? (
              <div className="text-sm text-emerald-100/60 text-center py-8">No events in this season yet.</div>
            ) : (
              Array.from(competitionMap.entries()).map(([compId, { name: compName, events: compEvents }]) => (
                <div key={compId ?? "standalone"} className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-200/40 font-semibold px-1">{compName}</div>
                  {compEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => router.push(`/majors/events/${ev.id}`)}
                      className="w-full text-left rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/80 p-3 space-y-1 hover:border-emerald-700/60 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-emerald-50 truncate">{ev.name}</span>
                        <span className={`text-[9px] uppercase px-2 py-0.5 rounded-full shrink-0 ${statusColour(ev.majors_status)}`}>
                          {ev.majors_status}
                        </span>
                      </div>
                      {ev.event_date && (
                        <div className="text-[11px] text-emerald-100/55">
                          {new Date(ev.event_date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "standings" && (
          <div className="space-y-2">
            {standings.length === 0 ? (
              <div className="text-sm text-emerald-100/60 text-center py-8">
                Standings will appear once events are complete and points are awarded.
              </div>
            ) : (
              standings.map((row) => (
                <div
                  key={row.profile_id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    row.position === 1
                      ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
                      : "border-emerald-900/50 bg-[#0b3b21]/60"
                  }`}
                >
                  <span className="w-6 text-center text-xs font-bold text-emerald-200/70 shrink-0">
                    {row.position ?? "—"}
                  </span>
                  {row.profile?.avatar_url ? (
                    <img src={row.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" loading="lazy" decoding="async" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                      {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "—"}</div>
                    <div className="text-[10px] text-emerald-100/55">
                      {row.events_played} event{row.events_played !== 1 ? "s" : ""} · {row.wins} win{row.wins !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-extrabold text-[#f5e6b0]">{row.season_points}</div>
                    <div className="text-[10px] text-emerald-100/50">pts</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "finances" && (
          <div className="space-y-4">
            {financialsError ? (
              <div className="rounded-xl border border-red-900/40 bg-red-950/30 p-4 text-sm text-red-300">{financialsError}</div>
            ) : financials == null ? (
              <div className="text-sm text-emerald-100/60 text-center py-8">Loading…</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Entry Fees", value: financials.total_entry_fees },
                    { label: "Extras", value: financials.total_extras },
                    { label: "Winnings Paid", value: financials.total_winnings_paid },
                    { label: "Pot Balance", value: financials.pot_balance },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
                      <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">{item.label}</div>
                      <div className={`text-sm font-bold ${item.label === "Pot Balance" && item.value < 0 ? "text-red-400" : "text-[#f5e6b0]"}`}>
                        £{item.value.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold px-1">Per Player</div>
                  {financials.per_player.length === 0 ? (
                    <div className="text-sm text-emerald-100/60 text-center py-4">No financial activity yet.</div>
                  ) : (
                    financials.per_player.map((p) => (
                      <div key={p.profile_id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
                        {p.profile?.avatar_url ? (
                          <img src={p.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" loading="lazy" decoding="async" />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                            {p.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-emerald-50 truncate">{p.profile?.name ?? "—"}</div>
                          <div className="text-[10px] text-emerald-200/40">
                            £{p.charged.toFixed(2)} charged · £{p.winnings.toFixed(2)} won
                          </div>
                        </div>
                        <div className={`text-sm font-bold shrink-0 ${p.net_balance > 0 ? "text-red-400" : p.net_balance < 0 ? "text-emerald-400" : "text-emerald-200/60"}`}>
                          {p.net_balance > 0 ? `+£${p.net_balance.toFixed(2)}` : p.net_balance < 0 ? `-£${Math.abs(p.net_balance).toFixed(2)}` : "—"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* Season Prize Pots */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Season Prize Pots</div>
                {!addPotForm && (
                  <button
                    type="button"
                    onClick={() => setAddPotForm({ name: "", description: "", distribution_type: "season_standings_winner", entry_fee_amount: "", entry_fee_notes: "", is_monetary: true, prize_description: "" })}
                    className="text-[10px] text-emerald-300/70 hover:text-emerald-300 border border-emerald-800/50 rounded-full px-2.5 py-1"
                  >
                    + Add Pot
                  </button>
                )}
              </div>

              {potError && (
                <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl px-3 py-2">
                  {potError}
                  <button type="button" onClick={() => setPotError(null)} className="ml-2 underline">Dismiss</button>
                </div>
              )}

              {seasonPots.length === 0 && !addPotForm && (
                <div className="text-[11px] text-emerald-200/30 text-center py-2">No season prize pots yet.</div>
              )}

              {seasonPots.map((pot) => {
                const isExpanded = expandedPotId === pot.id;
                const actionPrefix = potActionLoading?.startsWith(pot.id + ":") ? potActionLoading.split(":")[1] : null;
                return (
                  <div key={pot.id} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/50 overflow-hidden">
                    <div className="px-3 py-2.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-emerald-50">{pot.name}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${potStatusColour[pot.status] ?? ""}`}>{pot.status}</span>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-700/40 text-emerald-300/70">
                            {distTypeLabel[pot.distribution_type] ?? pot.distribution_type}
                          </span>
                        </div>
                        {pot.is_monetary && (
                          <div className="text-sm font-bold text-[#f5e6b0] shrink-0">£{pot.total_pot.toFixed(2)}</div>
                        )}
                        {!pot.is_monetary && pot.prize_description && (
                          <div className="text-[10px] text-amber-200/70 text-right shrink-0 max-w-[100px]">{pot.prize_description}</div>
                        )}
                      </div>
                      {pot.status !== "distributed" && (
                        <div className="flex flex-wrap gap-1.5">
                          {pot.distribution_type !== "entry_only" && (
                            <button
                              type="button"
                              onClick={() => handleProposeDist(pot.id)}
                              disabled={actionPrefix === "propose"}
                              className="text-[10px] px-2.5 py-1 rounded-full border border-amber-700/50 text-amber-200/70 hover:bg-amber-900/30 disabled:opacity-50"
                            >
                              {actionPrefix === "propose" ? "Calculating…" : "Propose Distribution"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeletePot(pot.id)}
                            disabled={actionPrefix === "delete"}
                            className="text-[10px] px-2 py-1 text-red-400/50 hover:text-red-400 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                      {(pot.entries.length > 0 || pot.payouts.length > 0) && (
                        <button
                          type="button"
                          onClick={() => setExpandedPotId(isExpanded ? null : pot.id)}
                          className="w-full text-[10px] text-emerald-200/40 hover:text-emerald-200/70 text-center"
                        >
                          {isExpanded ? "▲ Hide" : `▼ ${pot.entries.length} enrolled${pot.payouts.length > 0 ? ` · ${pot.payouts.length} payouts` : ""}`}
                        </button>
                      )}
                    </div>

                    {proposedDist?.potId === pot.id && (
                      <div className="border-t border-emerald-900/50 px-3 py-3 space-y-2 bg-amber-950/20">
                        <div className="text-[10px] font-semibold text-amber-200/80 uppercase tracking-wider">
                          Proposed — £{proposedDist.total_pot.toFixed(2)} total
                        </div>
                        <div className="space-y-1">
                          {proposedDist.proposed.map((p, i) => (
                            <div key={i} className="flex items-center justify-between text-[11px]">
                              <span className="text-emerald-200/80">{p.position ? `${p.position}. ` : ""}{p.profile?.name ?? p.profile_id}</span>
                              <span className="text-[#f5e6b0] font-semibold">
                                {p.amount != null ? `£${p.amount.toFixed(2)}` : pot.prize_description ?? "Prize"}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button type="button" onClick={() => setProposedDist(null)}
                            className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60">
                            Cancel
                          </button>
                          <button type="button" onClick={() => handleConfirmDist(pot.id)}
                            disabled={potActionLoading === pot.id + ":confirm"}
                            className="flex-1 py-1.5 rounded-full bg-amber-700/80 text-[11px] font-semibold text-white disabled:opacity-50">
                            {potActionLoading === pot.id + ":confirm" ? "Paying out…" : "Confirm & Pay Out"}
                          </button>
                        </div>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="border-t border-emerald-900/50 px-3 py-2.5 space-y-1">
                        {pot.entries.map((e) => (
                          <div key={e.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-emerald-200/80">{e.profile.name}</span>
                            <span className="text-emerald-200/50">£{e.amount_contributed.toFixed(2)}</span>
                          </div>
                        ))}
                        {pot.payouts.map((p) => (
                          <div key={p.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-emerald-200/80">{p.position ? `${p.position}. ` : ""}{p.profile.name}</span>
                            <span className="text-[#f5e6b0] font-semibold">
                              {p.amount != null ? `£${p.amount.toFixed(2)}` : (pot.prize_description ?? "Prize")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {addPotForm && (
                <div className="rounded-xl border border-emerald-700/40 bg-[#0b3b21]/50 px-3 py-3 space-y-2">
                  <div className="text-[11px] font-semibold text-emerald-200">New Season Prize Pot</div>
                  <input type="text" placeholder="Name (e.g. Season Points Pot)" value={addPotForm.name}
                    onChange={(e) => setAddPotForm((f) => f && { ...f, name: e.target.value })} className={inputCls} />
                  <select value={addPotForm.distribution_type}
                    onChange={(e) => setAddPotForm((f) => f && { ...f, distribution_type: e.target.value as PrizePotDistributionType | "winner_takes_all" })}
                    className={inputCls}>
                    <option value="season_standings_winner">Season standings winner (FedEx / points race)</option>
                    <option value="winner_takes_all">Winner takes all (event result)</option>
                    <option value="position_based">By finishing position (custom splits)</option>
                    <option value="equal_split">Equal split (all enrolled players)</option>
                    <option value="non_monetary">Non-cash prize (trophy, voucher, etc.)</option>
                    <option value="entry_only">Entry collected, no payout</option>
                  </select>
                  {addPotForm.distribution_type === "non_monetary" && (
                    <input type="text" placeholder="Prize description" value={addPotForm.prize_description}
                      onChange={(e) => setAddPotForm((f) => f && { ...f, prize_description: e.target.value, is_monetary: false })}
                      className={inputCls} />
                  )}
                  <input type="number" placeholder="Entry fee per player (£, optional)" value={addPotForm.entry_fee_amount}
                    onChange={(e) => setAddPotForm((f) => f && { ...f, entry_fee_amount: e.target.value })}
                    className={inputCls} min="0" step="0.01" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setAddPotForm(null); setPotError(null); }}
                      className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60">Cancel</button>
                    <button type="button" onClick={handleAddPot} disabled={addingPot}
                      className="flex-1 py-1.5 rounded-full bg-emerald-700 text-[11px] font-semibold text-white disabled:opacity-50">
                      {addingPot ? "Creating…" : "Create Pot"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

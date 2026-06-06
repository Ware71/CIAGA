"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CompetitionWithEventTemplates,
  EventWithGroup,
  EventTypeV2,
  EventScoringModel,
  EventPointsModel,
  EventCategory,
} from "@/lib/majors/types";
import { EVENT_TYPES, FORMAT_DEFAULT_SCORING, FORMAT_ALLOWS_SCORING_CHOICE } from "@/lib/events/constants";
import { HandicapRulesEditor, type HandicapRules, type HandicapMode } from "@/components/competitions/HandicapRulesEditor";

const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const SCORING_MODELS: { value: EventScoringModel; label: string }[] = [
  { value: "net", label: "Net" },
  { value: "gross", label: "Gross" },
  { value: "stableford_points", label: "Stableford Points" },
  { value: "match_result", label: "Match Result" },
];

const POINTS_MODELS: { value: EventPointsModel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fedex_style", label: "FedEx-style" },
  { value: "position_based", label: "Position-based" },
  { value: "custom_table", label: "Custom table" },
];

const CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "round_based", label: "Round-based" },
  { value: "aggregate", label: "Aggregate" },
  { value: "standalone", label: "Standalone" },
];

// ─── Local types for enriched competition history ─────────────────────────────

type CompetitionViewerStats = {
  appearances: number;
  wins: number;
  best_finish: number | null;
  avg_finish: number | null;
};

type EnrichedCompetition = {
  event: EventWithGroup;
  event_template: { id: string; name: string; sort_order: number } | null;
  winner: { profile_id: string; name: string | null; avatar_url: string | null; net_score: number | null } | null;
  viewer_entry: { position: number | null; net_score: number | null; gross_score: number | null; course_par: number | null; to_par: number | null } | null;
};

type EnrichedYearGroup = { year: number; events: EnrichedCompetition[] };

// ─── Edit Competition Settings modal ─────────────────────────────────────────

function CompetitionEditModal({
  competition,
  onClose,
  onSaved,
}: {
  competition: CompetitionWithEventTemplates;
  onClose: () => void;
  onSaved: (updated: CompetitionWithEventTemplates) => void;
}) {
  const settings = (competition.template_settings ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(competition.name ?? "");
  const [description, setDescription] = useState(competition.description ?? "");
  const [recurAnnually, setRecurAnnually] = useState(competition.recur_annually ?? true);
  const [typicalMonth, setTypicalMonth] = useState(competition.typical_month?.toString() ?? "");
  const [compCategory, setCompCategory] = useState<EventCategory>(competition.template_event_category ?? "round_based");
  const [compType, setCompType] = useState<EventTypeV2>(competition.template_event_type ?? "stroke");
  const [scoringModel, setScoringModel] = useState<EventScoringModel>(competition.template_scoring_model ?? "net");
  const [pointsModel, setPointsModel] = useState<EventPointsModel>(competition.template_points_model ?? "none");
  const [numRounds, setNumRounds] = useState(String(competition.template_num_rounds ?? "1"));
  const [rulesText, setRulesText] = useState(competition.template_rules_text ?? "");
  const [handicapRules, setHandicapRules] = useState<HandicapRules>({
    mode: ((settings.handicap_mode as string) ?? "allowance_pct") as HandicapMode,
    allowance_pct: settings.handicap_allowance_pct != null ? String(settings.handicap_allowance_pct) : "100",
    max_handicap: settings.max_handicap != null ? String(settings.max_handicap) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }

      const template_settings: Record<string, unknown> = { handicap_mode: handicapRules.mode };
      if (handicapRules.mode === "allowance_pct" || handicapRules.mode === "compare_against_lowest")
        template_settings.handicap_allowance_pct = parseInt(handicapRules.allowance_pct, 10) || 100;
      if (handicapRules.mode !== "none" && handicapRules.max_handicap)
        template_settings.max_handicap = parseInt(handicapRules.max_handicap, 10);

      const res = await fetch(`/api/majors/competitions/${competition.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          recur_annually: recurAnnually,
          typical_month: typicalMonth ? parseInt(typicalMonth, 10) : null,
          template_event_category: compCategory,
          template_event_type: compType,
          template_scoring_model: scoringModel,
          template_points_model: pointsModel,
          template_num_rounds: compCategory === "round_based" ? (parseInt(numRounds, 10) || 1) : null,
          template_rules_text: rulesText.trim() || null,
          template_settings,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return; }
      onSaved({ ...competition, ...json.competition });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 pb-[env(safe-area-inset-bottom)]" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-t-2xl bg-[#0a2e18] border-t border-x border-emerald-800/60 max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="text-sm font-semibold text-emerald-50">Edit Competition Settings</div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Competition Name *</label>
            <input
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Description</label>
            <textarea
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none resize-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-3 py-2">
            <span className="text-sm text-emerald-50">Recurs annually</span>
            <button
              type="button"
              onClick={() => setRecurAnnually((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${recurAnnually ? "bg-emerald-600" : "bg-emerald-900/60"}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${recurAnnually ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Typical Month</label>
            <select
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
              value={typicalMonth}
              onChange={(e) => setTypicalMonth(e.target.value)}
            >
              <option value="">No preference</option>
              {monthNames.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Default Category</label>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c.value} type="button" onClick={() => setCompCategory(c.value)}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${compCategory === c.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Default Format</label>
            <div className="grid grid-cols-2 gap-1.5">
              {EVENT_TYPES.map((t) => (
                <button key={t.value} type="button"
                  onClick={() => { setCompType(t.value); setScoringModel(FORMAT_DEFAULT_SCORING[t.value] ?? "net"); }}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${compType === t.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Default Scoring</label>
            {!FORMAT_ALLOWS_SCORING_CHOICE(compType) ? (
              <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-3 py-2 text-[11px] text-emerald-200/55">
                {scoringModel === "stableford_points" ? "Stableford Points" : "Match Result"} — determined by format
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {SCORING_MODELS.filter((s) => s.value === "net" || s.value === "gross").map((s) => (
                  <button key={s.value} type="button" onClick={() => setScoringModel(s.value)}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${scoringModel === s.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {scoringModel !== "gross" && (
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Default Handicap Rules</div>
              <HandicapRulesEditor compact value={handicapRules} onChange={setHandicapRules} />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Default Points Model</label>
            <div className="grid grid-cols-2 gap-1.5">
              {POINTS_MODELS.map((p) => (
                <button key={p.value} type="button" onClick={() => setPointsModel(p.value)}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${pointsModel === p.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {compCategory === "round_based" && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Default Rounds</label>
              <input type="number" min={1} max={10} value={numRounds}
                onChange={(e) => setNumRounds(e.target.value)}
                className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none" />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Default Rules</label>
            <textarea
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none resize-none"
              rows={3}
              placeholder="Rules that apply to all events in this competition…"
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
            />
          </div>
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="shrink-0 px-5 py-4 border-t border-emerald-900/50">
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-full border border-emerald-700/50 text-sm text-emerald-200 hover:bg-emerald-900/30">
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={!name.trim() || saving}
              className="flex-1 py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CompetitionDetailClient({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const [competition, setCompetition] = useState<CompetitionWithEventTemplates | null>(null);
  const [history, setHistory] = useState<EnrichedYearGroup[]>([]);
  const [viewerStats, setViewerStats] = useState<CompetitionViewerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"upcoming" | "history">("upcoming");
  const [showEditCompetition, setShowEditCompetition] = useState(false);

  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  const load = async () => {
    setLoading(true);
    try {
      const session = await getViewerSession();
      if (!session) { router.push("/login"); return; }
      const headers = { Authorization: `Bearer ${session.accessToken}` };

      const [competitionRes, historyRes] = await Promise.all([
        fetch(`/api/majors/competitions/${competitionId}`, { headers }),
        fetch(`/api/majors/competitions/${competitionId}/history`, { headers }),
      ]);

      if (competitionRes.ok) {
        const j = await competitionRes.json();
        const c = j.competition as CompetitionWithEventTemplates;
        // Sort event_templates by sort_order
        c.event_templates = (c.event_templates ?? []).sort((a, b) => a.sort_order - b.sort_order);
        setCompetition(c);

        // Determine caller's role in the group via members list
        if (c.group_id) {
          const memberRes = await fetch(`/api/majors/groups/${c.group_id}/members`, { headers });
          if (memberRes.ok) {
            const gj = await memberRes.json();
            const members: any[] = gj.members ?? [];
            const own = members.find((m) => m.profile_id === session.profileId);
            setMyRole(own?.role ?? null);
          }
        }
      }

      if (historyRes.ok) {
        const hj = await historyRes.json();
        setHistory(hj.history ?? []);
        setViewerStats(hj.viewer_stats ?? null);
      }

    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [competitionId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#071c0f] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-emerald-500/40 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="min-h-screen bg-[#071c0f] flex items-center justify-center text-emerald-200/50 text-sm">
        Competition not found.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#071c0f] text-emerald-50">
      {/* Header */}
      <div className="px-4 pt-10 pb-6 max-w-lg mx-auto">
        {competition.group_id && (
          <button
            type="button"
            onClick={() => router.push(`/majors/groups/${competition.group_id}`)}
            className="text-[11px] text-emerald-300/60 hover:text-emerald-300 mb-3 flex items-center gap-1"
          >
            ← Group
          </button>
        )}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-emerald-50">{competition.name}</h1>
            {competition.description && (
              <p className="text-sm text-emerald-100/55 mt-1">{competition.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {competition.recur_annually && (
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full border border-emerald-700/50 bg-emerald-900/30 text-emerald-300">
                Annual
              </span>
            )}
            {isAdminOrOwner && (
              <button
                type="button"
                onClick={() => setShowEditCompetition(true)}
                className="text-[11px] text-emerald-300/70 hover:text-emerald-200 border border-emerald-800/50 rounded-full px-2.5 py-1"
              >
                Edit Settings
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab navigation ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto px-4 pb-4 max-w-lg mx-auto scrollbar-none">
        {(["upcoming", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              activeTab === t
                ? "bg-emerald-700 text-white"
                : "text-emerald-200/60 hover:text-emerald-100"
            }`}
          >
            {t === "upcoming" ? "Upcoming" : "History"}
          </button>
        ))}
      </div>

      <div className="px-4 pb-24 max-w-lg mx-auto space-y-6">

        {/* ── Upcoming tab ─────────────────────────────────────────────────── */}
        {activeTab === "upcoming" && (() => {
          const COMPLETED_STATUSES = new Set(["completed", "official", "unofficial", "cancelled", "archived"]);
          const upcomingEvents = history.flatMap((yg) =>
            yg.events.filter((c) => !COMPLETED_STATUSES.has(c.event.majors_status))
          );
          return (
            <>
              {isAdminOrOwner && competition?.group_id && (
                <button
                  type="button"
                  onClick={() => router.push(`/majors/events/create?group_id=${competition.group_id}&competition_id=${competitionId}`)}
                  className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
                >
                  + New Event
                </button>
              )}
              {upcomingEvents.length === 0 ? (
                <div className="rounded-2xl border border-emerald-900/40 bg-[#0b3b21]/40 p-6 text-sm text-emerald-100/40 text-center">
                  No upcoming events.
                </div>
              ) : (
                <div className="space-y-2">
                  {upcomingEvents.map(({ event, event_template }) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => router.push(`/majors/events/${event.id}`)}
                      className="w-full text-left rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-4 py-3 hover:bg-emerald-900/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-emerald-50 truncate">
                            {event_template?.name ?? event.name}
                          </div>
                          {event.event_date && (
                            <div className="text-[11px] text-emerald-200/50 mt-0.5">
                              {new Date(event.event_date).toLocaleDateString("en-GB", {
                                day: "numeric", month: "short", year: "numeric",
                              })}
                            </div>
                          )}
                        </div>
                        <StatusPill status={event.majors_status} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {/* ── History tab ─────────────────────────────────────────────────── */}
        {activeTab === "history" && (() => {
          const COMPLETED_STATUSES = new Set(["completed", "official", "unofficial"]);
          const fmtPar = (v: number | null) =>
            v == null ? "—" : v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`;

          const completedYearGroups = history
            .map((yg) => ({
              ...yg,
              events: yg.events.filter((c) => COMPLETED_STATUSES.has(c.event.majors_status)),
            }))
            .filter((yg) => yg.events.length > 0);

          return (
            <>
              {/* My Competition Record */}
              {viewerStats && viewerStats.appearances > 0 && (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/65 mb-3 font-semibold">
                    My Competition Record
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: "Played", value: viewerStats.appearances },
                      { label: "Wins", value: viewerStats.wins },
                      {
                        label: "Best Pos.",
                        value: viewerStats.best_finish != null ? `P${viewerStats.best_finish}` : "—",
                      },
                      {
                        label: "Avg Pos.",
                        value: viewerStats.avg_finish != null ? viewerStats.avg_finish.toFixed(1) : "—",
                      },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <div className="text-base font-extrabold text-[#f5e6b0]">{stat.value}</div>
                        <div className="text-[10px] text-emerald-200/60">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Year group history cards */}
              {completedYearGroups.length === 0 ? (
                <div className="rounded-2xl border border-emerald-900/40 bg-[#0b3b21]/40 p-6 text-sm text-emerald-100/40 text-center">
                  No history yet.
                </div>
              ) : (
                completedYearGroups.map((yearGroup) => (
                  <div key={yearGroup.year} className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/60 p-4 space-y-3">
                    <div className="text-sm font-bold text-emerald-200">{yearGroup.year}</div>
                    <div className="space-y-2">
                      {yearGroup.events.map(({ event, event_template, winner, viewer_entry }) => {
                        const grossToPar =
                          viewer_entry?.gross_score != null && viewer_entry?.course_par != null
                            ? viewer_entry.gross_score - viewer_entry.course_par
                            : null;
                        return (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => router.push(`/majors/events/${event.id}`)}
                            className="w-full text-left rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-3 py-2.5 hover:bg-emerald-900/30 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-emerald-50 truncate">
                                  {event_template?.name ?? event.name}
                                </div>
                                {event.event_date && (
                                  <div className="text-[11px] text-emerald-200/45 mt-0.5">
                                    {new Date(event.event_date).toLocaleDateString("en-GB", {
                                      day: "numeric", month: "short",
                                    })}
                                  </div>
                                )}
                              </div>
                              {winner && (
                                <div className="text-right shrink-0 text-[11px] text-emerald-200/55">
                                  {winner.name ?? "—"}
                                  {winner.net_score != null && (
                                    <span className="text-emerald-300/60"> · {winner.net_score}</span>
                                  )}
                                </div>
                              )}
                            </div>
                            {viewer_entry && (
                              <div className="grid grid-cols-4 gap-1 pt-1.5 border-t border-emerald-900/30 mt-1.5 text-center">
                                {[
                                  { label: "Gross", value: viewer_entry.gross_score ?? "—" },
                                  { label: "G+/-", value: fmtPar(grossToPar) },
                                  { label: "Net", value: viewer_entry.net_score ?? "—" },
                                  { label: "N+/-", value: fmtPar(viewer_entry.to_par) },
                                ].map((s) => (
                                  <div key={s.label}>
                                    <div className="text-[12px] font-semibold text-emerald-100">{s.value}</div>
                                    <div className="text-[9px] text-emerald-200/45">{s.label}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </>
          );
        })()}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {showEditCompetition && (
        <CompetitionEditModal
          competition={competition}
          onClose={() => setShowEditCompetition(false)}
          onSaved={(updated) => {
            setCompetition(updated);
            setShowEditCompetition(false);
          }}
        />
      )}

    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    upcoming: "bg-sky-900/40 text-sky-300 border-sky-700/40",
    live: "bg-emerald-800/50 text-emerald-300 border-emerald-600/50",
    completed: "bg-emerald-900/30 text-emerald-400/70 border-emerald-800/40",
    cancelled: "bg-rose-900/30 text-rose-400 border-rose-700/30",
  };
  return (
    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CompetitionWithEventTemplates,
  CompetitionEventTemplate,
  CompetitionSeason,
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
  seasons_played: number;
  best_finish: number | null;
  avg_finish: number | null;
};

type EnrichedCompetition = {
  event: EventWithGroup;
  event_template: { id: string; name: string; sort_order: number } | null;
  winner: { profile_id: string; name: string | null; avatar_url: string | null; net_score: number | null } | null;
  viewer_entry: { position: number | null; net_score: number | null } | null;
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

// ─── Add / Edit Event Template modal ─────────────────────────────────────────

function EventTemplateModal({
  competitionId,
  existing,
  onClose,
  onSaved,
}: {
  competitionId: string;
  existing: CompetitionEventTemplate | null;
  onClose: () => void;
  onSaved: (et: CompetitionEventTemplate) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [month, setMonth] = useState(existing?.typical_month?.toString() ?? "");
  const [compType, setCompType] = useState<EventTypeV2 | "">(existing?.template_event_type ?? "");
  const [scoringModel, setScoringModel] = useState<EventScoringModel | "">(existing?.template_scoring_model ?? "");
  const [pointsModel, setPointsModel] = useState<EventPointsModel | "">(existing?.template_points_model ?? "");
  const [rulesText, setRulesText] = useState(existing?.template_rules_text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }
      const headers = { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        typical_month: month ? parseInt(month, 10) : null,
        template_event_type: compType || null,
        template_scoring_model: scoringModel || null,
        template_points_model: pointsModel || null,
        template_rules_text: rulesText.trim() || null,
      };

      let res: Response;
      if (existing) {
        res = await fetch(`/api/majors/competitions/${competitionId}/events/${existing.id}`, {
          method: "PATCH", headers, body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/majors/competitions/${competitionId}/events`, {
          method: "POST", headers, body: JSON.stringify(body),
        });
      }
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return; }
      onSaved(json.event_template);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[#0a2e18] border border-emerald-800/60 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="text-sm font-semibold text-emerald-50">
            {existing ? "Edit Event" : "Add Event"}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Event Name *</label>
            <input
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none"
              placeholder="e.g. The Masters"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Description</label>
            <input
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none"
              placeholder="Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Typical Month</label>
            <select
              className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="">No preference</option>
              {monthNames.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="border-t border-emerald-900/40 pt-3 space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/40">Overrides (leave blank to inherit from competition)</div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Format Override</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setCompType("")}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${compType === "" ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  Inherit
                </button>
                {EVENT_TYPES.map((t) => (
                  <button key={t.value} type="button" onClick={() => setCompType(t.value)}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${compType === t.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Scoring Override</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setScoringModel("")}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${scoringModel === "" ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  Inherit
                </button>
                {SCORING_MODELS.map((s) => (
                  <button key={s.value} type="button" onClick={() => setScoringModel(s.value)}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${scoringModel === s.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Points Override</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setPointsModel("")}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${pointsModel === "" ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  Inherit
                </button>
                {POINTS_MODELS.map((p) => (
                  <button key={p.value} type="button" onClick={() => setPointsModel(p.value)}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${pointsModel === p.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Rules Override</label>
              <textarea
                className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none resize-none"
                rows={2}
                placeholder="Leave blank to inherit competition rules…"
                value={rulesText}
                onChange={(e) => setRulesText(e.target.value)}
              />
            </div>
          </div>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="shrink-0 px-5 py-4 border-t border-emerald-900/50">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-full border border-emerald-700/50 text-sm text-emerald-200 hover:bg-emerald-900/30"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="flex-1 py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create Season modal ──────────────────────────────────────────────────────

function CreateSeasonModal({
  competitionId,
  eventTemplates,
  onClose,
  onCreated,
}: {
  competitionId: string;
  eventTemplates: CompetitionEventTemplate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const [seasonType, setSeasonType] = useState<"calendar_year" | "custom">("calendar_year");
  const [year, setYear] = useState(currentYear.toString());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [seasonLabel, setSeasonLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-event optional date overrides, keyed by template ID
  const [eventDates, setEventDates] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    eventTemplates.forEach((et) => {
      init[et.id] = et.typical_month
        ? `${currentYear}-${String(et.typical_month).padStart(2, "0")}-01`
        : "";
    });
    return init;
  });

  const handleYearChange = (val: string) => {
    setYear(val);
    const y = parseInt(val, 10);
    if (!y || y < 2000 || y > 2100) return;
    const updated: Record<string, string> = {};
    eventTemplates.forEach((et) => {
      updated[et.id] = et.typical_month
        ? `${y}-${String(et.typical_month).padStart(2, "0")}-01`
        : "";
    });
    setEventDates(updated);
  };

  // Auto-compute label from dates when custom
  const computedLabel = (() => {
    if (seasonType === "calendar_year") return year || "";
    if (!startDate || !endDate) return "";
    const sy = new Date(startDate).getFullYear();
    const ey = new Date(endDate).getFullYear();
    return sy === ey ? `${sy} Season` : `${sy % 100}/${ey % 100} Season`;
  })();

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }

      let body: Record<string, unknown>;
      if (seasonType === "calendar_year") {
        const y = parseInt(year, 10);
        if (!y) { setError("Valid year is required"); return; }
        const event_overrides = eventTemplates
          .filter((et) => eventDates[et.id])
          .map((et) => ({ template_id: et.id, event_date: eventDates[et.id] }));
        body = { year: y, ...(event_overrides.length > 0 ? { event_overrides } : {}) };
      } else {
        if (!startDate || !endDate) { setError("Start and end dates are required"); return; }
        body = {
          season_type: "custom",
          start_date: startDate,
          end_date: endDate,
          season_label: (seasonLabel.trim() || computedLabel) || undefined,
        };
      }

      const res = await fetch(`/api/majors/competitions/${competitionId}/instantiate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create season"); return; }
      onCreated();
    } finally {
      setCreating(false);
    }
  };

  const inputCls = "w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[#0a2e18] border border-emerald-800/60 max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="text-sm font-semibold text-emerald-50">Create Season</div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-4">

          {/* Season type toggle */}
          <div className="flex gap-2">
            {(["calendar_year", "custom"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSeasonType(t)}
                className={`flex-1 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${
                  seasonType === t ? "bg-emerald-700 text-white" : "border border-emerald-800/50 text-emerald-200/60 hover:text-emerald-100"
                }`}
              >
                {t === "calendar_year" ? "Calendar Year" : "Custom Dates"}
              </button>
            ))}
          </div>

          {seasonType === "calendar_year" ? (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Year</label>
              <input type="number" className={inputCls} value={year} onChange={(e) => handleYearChange(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Start Date</label>
                <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">End Date</label>
                <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">
                  Season Label
                  <span className="normal-case ml-1 text-emerald-200/35">(auto: {computedLabel || "—"})</span>
                </label>
                <input
                  type="text"
                  className={inputCls}
                  value={seasonLabel}
                  onChange={(e) => setSeasonLabel(e.target.value)}
                  placeholder={computedLabel || "e.g. 25/26 Season"}
                />
              </div>
            </div>
          )}

          {seasonType === "calendar_year" && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/60">
                Event Dates
                <span className="normal-case ml-1 text-emerald-200/35">(optional — leave blank to set later)</span>
              </div>
              <div className="space-y-2">
                {eventTemplates.map((et) => (
                  <div
                    key={et.id}
                    className="rounded-xl border border-emerald-900/50 bg-emerald-950/40 px-3 py-2.5 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-sm text-emerald-100/80 flex-1 truncate">{et.name}</span>
                      {et.typical_month && (
                        <span className="text-[10px] text-emerald-200/40 shrink-0">
                          ({monthNames[et.typical_month - 1]})
                        </span>
                      )}
                    </div>
                    <input
                      type="date"
                      className="w-full rounded-lg bg-emerald-900/30 border border-emerald-800/40 px-2 py-1.5 text-xs text-emerald-50 focus:outline-none"
                      value={eventDates[et.id] ?? ""}
                      onChange={(e) =>
                        setEventDates((prev) => ({ ...prev, [et.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="shrink-0 px-5 py-4 border-t border-emerald-900/50">
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-full border border-emerald-700/50 text-sm text-emerald-200 hover:bg-emerald-900/30">
              Cancel
            </button>
            <button type="button" onClick={handleCreate}
              disabled={creating}
              className="flex-1 py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40">
              {creating ? "Creating…" : `Create Season`}
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
  const [seasons, setSeasons] = useState<CompetitionSeason[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"history" | "events">("history");
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CompetitionEventTemplate | null>(null);
  const [showCreateSeason, setShowCreateSeason] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [showEditCompetition, setShowEditCompetition] = useState(false);

  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  const load = async () => {
    setLoading(true);
    try {
      const session = await getViewerSession();
      if (!session) { router.push("/login"); return; }
      const headers = { Authorization: `Bearer ${session.accessToken}` };

      const [competitionRes, historyRes, seasonsRes] = await Promise.all([
        fetch(`/api/majors/competitions/${competitionId}`, { headers }),
        fetch(`/api/majors/competitions/${competitionId}/history`, { headers }),
        fetch(`/api/majors/seasons?competition_id=${competitionId}`, { headers }).catch(() => null),
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

      if (seasonsRes?.ok) {
        const sj = await seasonsRes.json();
        setSeasons(sj.seasons ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [competitionId]);

  const handleEventSaved = (et: CompetitionEventTemplate) => {
    setCompetition((prev) => {
      if (!prev) return prev;
      const exists = prev.event_templates.find((e) => e.id === et.id);
      const updated = exists
        ? prev.event_templates.map((e) => (e.id === et.id ? et : e))
        : [...prev.event_templates, et];
      return { ...prev, event_templates: updated.sort((a, b) => a.sort_order - b.sort_order) };
    });
    setShowAddEvent(false);
    setEditingEvent(null);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm("Remove this event template? Past events will not be affected.")) return;
    setDeletingEventId(eventId);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/events/${eventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        setCompetition((prev) =>
          prev ? { ...prev, event_templates: prev.event_templates.filter((e) => e.id !== eventId) } : prev
        );
      }
    } finally {
      setDeletingEventId(null);
    }
  };

  const handleMoveEvent = async (eventId: string, direction: "up" | "down") => {
    if (!competition) return;
    const idx = competition.event_templates.findIndex((e) => e.id === eventId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= competition.event_templates.length) return;

    const updated = [...competition.event_templates];
    const newOrder = updated[swapIdx].sort_order;
    const currOrder = updated[idx].sort_order;

    // Swap sort_order values
    updated[idx] = { ...updated[idx], sort_order: newOrder };
    updated[swapIdx] = { ...updated[swapIdx], sort_order: currOrder };
    updated.sort((a, b) => a.sort_order - b.sort_order);

    setCompetition({ ...competition, event_templates: updated });

    // Persist both
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
    await Promise.all([
      fetch(`/api/majors/competitions/${competitionId}/events/${updated[swapIdx].id}`, {
        method: "PATCH", headers, body: JSON.stringify({ sort_order: currOrder }),
      }),
      fetch(`/api/majors/competitions/${competitionId}/events/${updated[idx].id}`, {
        method: "PATCH", headers, body: JSON.stringify({ sort_order: newOrder }),
      }),
    ]);
  };

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

  const eventTemplates = competition.event_templates ?? [];

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
        {(["history", "events"] as const).map((t) => (
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
            {t === "history" ? "History" : "Events"}
          </button>
        ))}
      </div>

      <div className="px-4 pb-24 max-w-lg mx-auto space-y-6">

        {/* ── History tab ─────────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <>
            {/* My Competition Record — shown only when viewer has played */}
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
                {viewerStats.seasons_played > 0 && (
                  <div className="mt-3 text-[10px] text-emerald-200/45 text-center">
                    {viewerStats.seasons_played} {viewerStats.seasons_played === 1 ? "season" : "seasons"} played
                  </div>
                )}
              </div>
            )}

            {/* Year group history cards */}
            {history.length === 0 ? (
              <div className="rounded-2xl border border-emerald-900/40 bg-[#0b3b21]/40 p-6 text-sm text-emerald-100/40 text-center">
                No history yet.
              </div>
            ) : (
              history.map((yearGroup) => {
                const matchedSeason = seasons.find((s) => s.season_year === yearGroup.year);
                return (
                  <div key={yearGroup.year} className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/60 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-emerald-200">{yearGroup.year}</div>
                      {matchedSeason && (
                        <button
                          type="button"
                          onClick={() => router.push(`/majors/seasons/${matchedSeason.id}`)}
                          className="text-[10px] text-emerald-200/55 hover:text-emerald-200 border border-emerald-900/50 rounded-full px-2 py-0.5 transition-colors"
                        >
                          Season →
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {yearGroup.events.map(({ event, event_template, winner, viewer_entry }) => (
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
                            <div className="text-right shrink-0">
                              <StatusPill status={event.majors_status} />
                              {winner && event.majors_status === "completed" && (
                                <div className="text-[11px] text-emerald-200/55 mt-1">
                                  {winner.name ?? "—"}
                                  {winner.net_score != null && (
                                    <span className="text-emerald-300/60"> · {winner.net_score}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          {viewer_entry && (
                            <div className="flex items-center gap-2 pt-1.5 border-t border-emerald-900/30 mt-1.5">
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 border border-emerald-800/40 shrink-0">
                                You
                              </span>
                              <span className="text-[11px] text-emerald-100/70">
                                {viewer_entry.position != null ? `P${viewer_entry.position}` : "DNS"}
                                {viewer_entry.net_score != null && ` · ${viewer_entry.net_score}`}
                              </span>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── Events tab ──────────────────────────────────────────────────── */}
        {activeTab === "events" && (
          <section className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-emerald-200/70 uppercase tracking-wider">
                Events in this Competition
              </div>
              {isAdminOrOwner && (
                <button
                  type="button"
                  onClick={() => setShowAddEvent(true)}
                  className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-100"
                >
                  + Add
                </button>
              )}
            </div>

            {eventTemplates.length === 0 ? (
              <div className="text-sm text-emerald-100/40 py-4 text-center">
                {isAdminOrOwner
                  ? "No events yet. Add the events that make up this competition."
                  : "No events defined for this competition yet."}
              </div>
            ) : (
              <div className="space-y-2">
                {eventTemplates.map((et, idx) => (
                  <div
                    key={et.id}
                    className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-emerald-950/40 px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-emerald-50">{et.name}</div>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {et.typical_month != null && (
                          <span className="text-[10px] text-emerald-200/45 border border-emerald-900/40 rounded-full px-1.5 py-0.5">
                            {monthNames[et.typical_month - 1]}
                          </span>
                        )}
                        {et.template_event_type && (
                          <span className="text-[10px] text-emerald-200/45 border border-emerald-900/40 rounded-full px-1.5 py-0.5 capitalize">
                            {et.template_event_type}
                          </span>
                        )}
                        {et.template_scoring_model && (
                          <span className="text-[10px] text-emerald-200/45 border border-emerald-900/40 rounded-full px-1.5 py-0.5 capitalize">
                            {et.template_scoring_model}
                          </span>
                        )}
                      </div>
                    </div>
                    {isAdminOrOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMoveEvent(et.id, "up")}
                          disabled={idx === 0}
                          className="w-6 h-6 flex items-center justify-center rounded text-emerald-300/50 hover:text-emerald-200 disabled:opacity-20"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveEvent(et.id, "down")}
                          disabled={idx === eventTemplates.length - 1}
                          className="w-6 h-6 flex items-center justify-center rounded text-emerald-300/50 hover:text-emerald-200 disabled:opacity-20"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingEvent(et)}
                          className="w-6 h-6 flex items-center justify-center rounded text-emerald-300/50 hover:text-emerald-200"
                          title="Edit"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(et.id)}
                          disabled={deletingEventId === et.id}
                          className="w-6 h-6 flex items-center justify-center rounded text-rose-400/50 hover:text-rose-300 disabled:opacity-40"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Create season CTA */}
            {isAdminOrOwner && eventTemplates.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCreateSeason(true)}
                className="w-full py-2.5 rounded-full bg-emerald-700/90 text-sm font-semibold text-white hover:bg-emerald-600 mt-1"
              >
                + Create {new Date().getFullYear()} Season
              </button>
            )}
          </section>
        )}
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

      {(showAddEvent || editingEvent) && (
        <EventTemplateModal
          competitionId={competitionId}
          existing={editingEvent}
          onClose={() => { setShowAddEvent(false); setEditingEvent(null); }}
          onSaved={handleEventSaved}
        />
      )}

      {showCreateSeason && (
        <CreateSeasonModal
          competitionId={competitionId}
          eventTemplates={eventTemplates}
          onClose={() => setShowCreateSeason(false)}
          onCreated={() => {
            setShowCreateSeason(false);
            load(); // reload to show new season
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

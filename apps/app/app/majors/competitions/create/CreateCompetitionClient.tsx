"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CompetitionTypeV2,
  CompetitionScoringModel,
  CompetitionPointsModel,
  CompetitionCategory,
  CompetitionSeries,
  MajorGroup,
} from "@/lib/majors/types";


const COMP_CATEGORIES: { value: CompetitionCategory; label: string; desc: string }[] = [
  { value: "round_based", label: "Round-based", desc: "Requires round submissions to score" },
  { value: "aggregate", label: "Aggregate", desc: "Points race / Order of Merit — no round needed" },
  { value: "standalone", label: "Standalone", desc: "Own leaderboard, round is optional" },
];

const COMP_TYPES: { value: CompetitionTypeV2; label: string }[] = [
  { value: "stroke", label: "Strokeplay" },
  { value: "stableford", label: "Stableford" },
  { value: "matchplay", label: "Match Play" },
  { value: "skins", label: "Skins" },
  { value: "scramble", label: "Scramble" },
  { value: "bestball", label: "Best Ball" },
  { value: "custom", label: "Custom" },
];

const SCORING_MODELS: { value: CompetitionScoringModel; label: string }[] = [
  { value: "net", label: "Net (handicap adjusted)" },
  { value: "gross", label: "Gross (no handicap)" },
  { value: "stableford_points", label: "Stableford Points" },
  { value: "match_result", label: "Match Result" },
];

const POINTS_MODELS: { value: CompetitionPointsModel; label: string }[] = [
  { value: "none", label: "No points (event result only)" },
  { value: "fedex_style", label: "FedEx-style season points" },
  { value: "position_based", label: "Position-based points" },
  { value: "custom_table", label: "Custom points table" },
];

const AGGREGATE_SOURCES = [
  { value: "group_standings", label: "Group season standings" },
  { value: "competition_ids", label: "Specific competitions" },
  { value: "custom", label: "Custom" },
] as const;

type AggregateSource = "group_standings" | "competition_ids" | "custom";

type FormState = {
  name: string;
  group_id: string;
  description: string;
  competition_category: CompetitionCategory;
  competition_type: CompetitionTypeV2;
  format: string;
  course_search: string;
  competition_date: string;
  entry_window_start: string;
  entry_window_end: string;
  rules_text: string;
  scoring_model: CompetitionScoringModel;
  points_model: CompetitionPointsModel;
  num_rounds: string;
  standings_contribution: string;
  // Series fields
  series_id: string;
  competition_year: string;
  // Aggregate config
  aggregate_source: AggregateSource;
  aggregate_top_n: string;
  aggregate_include_round: boolean;
  // Handicap rules
  handicap_allowance_pct: string;
  handicap_max: string;
};

const INITIAL: FormState = {
  name: "",
  group_id: "",
  description: "",
  competition_category: "round_based",
  competition_type: "stroke",
  format: "",
  course_search: "",
  competition_date: "",
  entry_window_start: "",
  entry_window_end: "",
  rules_text: "",
  scoring_model: "net",
  points_model: "none",
  num_rounds: "1",
  standings_contribution: "event_only",
  series_id: "",
  competition_year: String(new Date().getFullYear()),
  aggregate_source: "group_standings",
  aggregate_top_n: "",
  aggregate_include_round: false,
  handicap_allowance_pct: "100",
  handicap_max: "",
};

export default function CreateCompetitionClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedGroupId = searchParams.get("group_id") ?? "";

  const preselectedSeriesId = searchParams.get("series_id") ?? "";
  const preselectedYear = searchParams.get("year") ?? String(new Date().getFullYear());

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    ...INITIAL,
    group_id: preselectedGroupId,
    series_id: preselectedSeriesId,
    competition_year: preselectedYear,
  });
  const [templateSeries, setTemplateSeries] = useState<CompetitionSeries | null>(null);
  const [myGroups, setMyGroups] = useState<MajorGroup[]>([]);
  const [groupSeries, setGroupSeries] = useState<CompetitionSeries[]>([]);
  const [showNewSeriesModal, setShowNewSeriesModal] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState("");
  const [creatingSeries, setCreatingSeries] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAggregate = form.competition_category === "aggregate";
  const totalSteps = 6;

  useEffect(() => {
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/majors/groups?mode=mine", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setMyGroups((j.groups ?? []).filter((g: any) =>
          g.role === "owner" || g.role === "admin"
        ));
      }
    })();
  }, []);

  // If launched from a series template, fetch and pre-populate
  useEffect(() => {
    if (!preselectedSeriesId) return;
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/series/${preselectedSeriesId}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) return;
      const j = await res.json();
      const s: CompetitionSeries = j.series;
      if (!s) return;
      setTemplateSeries(s);
      const settings = (s.template_settings ?? {}) as Record<string, unknown>;
      setForm((prev) => ({
        ...prev,
        competition_category: s.template_competition_category ?? prev.competition_category,
        competition_type: s.template_competition_type ?? prev.competition_type,
        scoring_model: s.template_scoring_model ?? prev.scoring_model,
        points_model: s.template_points_model ?? prev.points_model,
        rules_text: s.template_rules_text ?? prev.rules_text,
        handicap_allowance_pct: settings.handicap_allowance_pct != null
          ? String(settings.handicap_allowance_pct)
          : prev.handicap_allowance_pct,
        handicap_max: settings.max_handicap != null
          ? String(settings.max_handicap)
          : prev.handicap_max,
      }));
    })();
  }, [preselectedSeriesId]);

  // Load series whenever group selection changes
  useEffect(() => {
    if (!form.group_id) { setGroupSeries([]); return; }
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/series?group_id=${form.group_id}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setGroupSeries(j.series ?? []);
      }
    })();
  }, [form.group_id]);

  const update = (field: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canNext = (): boolean => {
    if (step === 0) return form.name.trim().length > 0;
    return true;
  };

  const handleCreateSeries = async () => {
    if (!newSeriesName.trim() || !form.group_id) return;
    setCreatingSeries(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/majors/series", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: form.group_id,
          name: newSeriesName.trim(),
          template_competition_category: form.competition_category,
          template_competition_type: form.competition_type,
          template_scoring_model: form.scoring_model,
          template_points_model: form.points_model,
        }),
      });
      const j = await res.json();
      if (res.ok && j.series) {
        setGroupSeries((prev) => [...prev, j.series]);
        update("series_id", j.series.id);
        setShowNewSeriesModal(false);
        setNewSeriesName("");
      }
    } finally {
      setCreatingSeries(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }

      const aggregate_config = isAggregate
        ? {
            source: form.aggregate_source,
            top_n_events: form.aggregate_top_n ? parseInt(form.aggregate_top_n, 10) : null,
            include_round: form.aggregate_include_round,
          }
        : {};

      const res = await fetch("/api/majors/competitions", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description || null,
          group_id: form.group_id || null,
          competition_category: form.competition_category,
          competition_type: isAggregate ? "custom" : form.competition_type,
          format: form.format || null,
          competition_date: form.competition_date || null,
          entry_window_start: form.entry_window_start || null,
          entry_window_end: form.entry_window_end || null,
          rules_text: form.rules_text || null,
          scoring_model: form.scoring_model,
          points_model: form.points_model,
          num_rounds: isAggregate ? 0 : (parseInt(form.num_rounds, 10) || 1),
          standings_contribution: form.standings_contribution,
          series_id: form.series_id || null,
          competition_year: form.series_id && form.competition_year
            ? parseInt(form.competition_year, 10)
            : null,
          aggregate_config,
          handicap_rules: form.scoring_model !== "gross"
            ? {
                allowance_pct: parseInt(form.handicap_allowance_pct, 10) || 100,
                max_handicap: form.handicap_max ? parseInt(form.handicap_max, 10) : null,
              }
            : {},
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create competition"); return; }
      router.push(`/majors/competitions/${json.competition.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    /* Step 0: Name, Category, Format (if round-based/standalone) */
    <div key="step0" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Competition Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Spring Major 2026"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={2}
          placeholder="Describe this competition"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Category</label>
        <div className="space-y-2">
          {COMP_CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => update("competition_category", c.value)}
              className={`w-full rounded-xl border px-4 py-2 text-left transition-colors ${
                form.competition_category === c.value
                  ? "border-emerald-500 bg-emerald-900/50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
              }`}
            >
              <div className="text-sm font-semibold text-emerald-50">{c.label}</div>
              <div className="text-[10px] text-emerald-200/55">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>
      {!isAggregate && (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Format</label>
          <div className="grid grid-cols-2 gap-2">
            {COMP_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => update("competition_type", t.value)}
                className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                  form.competition_type === t.value
                    ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                    : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,

    /* Step 1: Group, Series, Date */
    <div key="step1" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Parent Group (optional)</label>
        {myGroups.length > 0 ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => { update("group_id", ""); update("series_id", ""); }}
              className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                form.group_id === ""
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              No group (standalone)
            </button>
            {myGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => update("group_id", g.id)}
                className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                  form.group_id === g.id
                    ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                    : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-emerald-100/50">
            You have no groups to assign this to.{" "}
            <button
              type="button"
              onClick={() => router.push("/majors/groups/create")}
              className="underline text-emerald-300"
            >
              Create one first?
            </button>
          </div>
        )}
      </div>

      {/* Series selection — only shown when a group is selected */}
      {form.group_id && (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Competition Series (optional)</label>
          <button
            type="button"
            onClick={() => update("series_id", "")}
            className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
              form.series_id === ""
                ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
            }`}
          >
            Not part of a series
          </button>
          {groupSeries.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => update("series_id", s.id)}
              className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                form.series_id === s.id
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              {s.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowNewSeriesModal(true)}
            className="text-[11px] text-emerald-400 underline"
          >
            + Create new series
          </button>
        </div>
      )}

      {/* Year — shown when a series is selected */}
      {form.series_id && (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Year</label>
          <input
            type="number"
            value={form.competition_year}
            onChange={(e) => update("competition_year", e.target.value)}
            min={2000}
            max={2100}
            className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Competition Date</label>
        <input
          type="date"
          value={form.competition_date}
          onChange={(e) => update("competition_date", e.target.value)}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
        />
      </div>
    </div>,

    /* Step 2: Entry window / rounds — or aggregate config */
    <div key="step2" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Entry Opens</label>
        <input
          type="datetime-local"
          value={form.entry_window_start}
          onChange={(e) => update("entry_window_start", e.target.value)}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Entry Closes</label>
        <input
          type="datetime-local"
          value={form.entry_window_end}
          onChange={(e) => update("entry_window_end", e.target.value)}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
        />
      </div>
      {isAggregate ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Aggregate Source</label>
            <div className="space-y-2">
              {AGGREGATE_SOURCES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => update("aggregate_source", s.value)}
                  className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                    form.aggregate_source === s.value
                      ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                      : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Count Best N Events Only (optional)</label>
            <input
              type="number"
              value={form.aggregate_top_n}
              onChange={(e) => update("aggregate_top_n", e.target.value)}
              placeholder="e.g. 5 — leave blank to count all"
              min={1}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
            />
          </div>
          <button
            type="button"
            onClick={() => update("aggregate_include_round", !form.aggregate_include_round)}
            className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
              form.aggregate_include_round
                ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
            }`}
          >
            <div className="font-semibold">Include a final round</div>
            <div className="text-[10px] text-emerald-200/55">e.g. a FedEx Cup finale round that also contributes to the score</div>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Number of Rounds</label>
          <input
            type="number"
            min={1}
            max={10}
            value={form.num_rounds}
            onChange={(e) => update("num_rounds", e.target.value)}
            className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
          />
        </div>
      )}
    </div>,

    /* Step 3: Scoring model + handicap */
    <div key="step3" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Scoring Model</label>
        <div className="space-y-2">
          {SCORING_MODELS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => update("scoring_model", s.value)}
              className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                form.scoring_model === s.value
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Handicap config — shown when scoring involves handicap */}
      {form.scoring_model !== "gross" && (
        <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/55 font-semibold">Handicap Rules</div>
          <div className="space-y-1">
            <label className="text-[11px] text-emerald-200/65">Handicap Allowance %</label>
            <input
              type="number"
              min={0}
              max={100}
              value={form.handicap_allowance_pct}
              onChange={(e) => update("handicap_allowance_pct", e.target.value)}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
            />
            <p className="text-[10px] text-emerald-100/40">e.g. 90 = players use 90% of their course handicap</p>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-emerald-200/65">Max Handicap (optional)</label>
            <input
              type="number"
              min={0}
              value={form.handicap_max}
              onChange={(e) => update("handicap_max", e.target.value)}
              placeholder="Leave blank for no limit"
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
            />
            <p className="text-[10px] text-emerald-100/40">Cap the maximum handicap that can be applied</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Points Model</label>
        <div className="space-y-2">
          {POINTS_MODELS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => update("points_model", p.value)}
              className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                form.points_model === p.value
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>,

    /* Step 4: Rules, standings */
    <div key="step4" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Competition Rules (optional)</label>
        <textarea
          value={form.rules_text}
          onChange={(e) => update("rules_text", e.target.value)}
          rows={5}
          placeholder="Any specific rules or conditions for this competition..."
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Season Standings</label>
        {(["event_only", "season", "both"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => update("standings_contribution", v)}
            className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
              form.standings_contribution === v
                ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
            }`}
          >
            {v === "event_only" && "Event only (no season points)"}
            {v === "season" && "Season standings only"}
            {v === "both" && "Event result + season standings"}
          </button>
        ))}
      </div>
    </div>,

    /* Step 5: Confirm */
    <div key="step5" className="space-y-4">
      <div className="text-sm font-semibold text-emerald-50">Confirm Competition</div>
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
        {[
          { label: "Name", value: form.name },
          { label: "Category", value: form.competition_category },
          !isAggregate ? { label: "Format", value: form.competition_type } : null,
          { label: "Scoring", value: form.scoring_model },
          form.scoring_model !== "gross" ? { label: "Handicap %", value: `${form.handicap_allowance_pct || 100}%${form.handicap_max ? ` (max ${form.handicap_max})` : ""}` } : null,
          { label: "Points", value: form.points_model },
          !isAggregate ? { label: "Rounds", value: form.num_rounds } : null,
          isAggregate ? { label: "Aggregate source", value: form.aggregate_source } : null,
          isAggregate && form.aggregate_top_n ? { label: "Top N events", value: form.aggregate_top_n } : null,
          form.group_id ? { label: "Group", value: myGroups.find((g) => g.id === form.group_id)?.name ?? form.group_id } : null,
          form.series_id ? { label: "Series", value: groupSeries.find((s) => s.id === form.series_id)?.name ?? form.series_id } : null,
          form.series_id && form.competition_year ? { label: "Year", value: form.competition_year } : null,
          form.competition_date ? { label: "Date", value: form.competition_date } : null,
          form.standings_contribution !== "event_only" ? { label: "Standings", value: form.standings_contribution } : null,
        ]
          .filter(Boolean)
          .map((item) => (
            <div key={item!.label} className="flex justify-between text-sm">
              <span className="text-emerald-200/55">{item!.label}</span>
              <span className="text-emerald-50 capitalize">{item!.value}</span>
            </div>
          ))}
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
    </div>,
  ];

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← {step === 0 ? "Back" : "Previous"}
        </button>
        <h1 className="text-base font-semibold text-[#f5e6b0]">Create Competition</h1>
        <div className="text-[11px] text-emerald-200/55">
          {step + 1}/{totalSteps}
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? "bg-emerald-600" : "bg-emerald-900/50"
            }`}
          />
        ))}
      </div>

      {/* Template banner */}
      {templateSeries && (
        <div className="mb-5 rounded-xl border border-emerald-700/50 bg-emerald-900/30 px-4 py-2.5 flex items-center gap-2">
          <span className="text-[10px] text-emerald-400 shrink-0">Template</span>
          <span className="text-[11px] font-semibold text-emerald-50 truncate">{templateSeries.name}</span>
          <span className="text-[10px] text-emerald-200/50 shrink-0">· {preselectedYear}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.18 }}
          >
            {steps[step]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-6 pb-2">
        {step < totalSteps - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Competition"}
          </button>
        )}
      </div>

      {/* New series modal */}
      {showNewSeriesModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="w-full max-w-sm bg-[#0c2e18] rounded-t-2xl p-6 space-y-4">
            <div className="text-sm font-semibold text-emerald-50">New Competition Series</div>
            <input
              type="text"
              value={newSeriesName}
              onChange={(e) => setNewSeriesName(e.target.value)}
              placeholder="e.g. The Club Masters"
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowNewSeriesModal(false); setNewSeriesName(""); }}
                className="flex-1 py-2.5 rounded-full border border-emerald-800 text-sm text-emerald-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSeries}
                disabled={!newSeriesName.trim() || creatingSeries}
                className="flex-1 py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-40"
              >
                {creatingSeries ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

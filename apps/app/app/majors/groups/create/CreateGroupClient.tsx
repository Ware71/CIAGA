"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  MajorGroupType,
  MajorGroupPrivacy,
  MajorGroupJoinMethod,
  GroupScoringPrefs,
  CompetitionTypeV2,
  CompetitionScoringModel,
} from "@/lib/majors/types";
import { SCORING_MODELS, POINTS_MODELS, STANDINGS_CONTRIBUTIONS, COMP_TYPES, FORMAT_DEFAULT_SCORING, FORMAT_ALLOWS_SCORING_CHOICE } from "@/lib/competitions/constants";
import { HandicapRulesEditor, type HandicapRules } from "@/components/competitions/HandicapRulesEditor";

const GROUP_TYPES: { value: MajorGroupType; label: string; desc: string }[] = [
  { value: "league", label: "League", desc: "Season-long standings competition" },
  { value: "tour", label: "Tour", desc: "Multi-event tour series" },
  { value: "season", label: "Season", desc: "Time-bounded competition season" },
  { value: "major_series", label: "Major Series", desc: "Annual competition that recurs each year" },
  { value: "oneoff", label: "One-off", desc: "Single event container" },
  { value: "matchplay_series", label: "Match Play", desc: "Match play bracket or series" },
  { value: "custom", label: "Custom", desc: "Your own format" },
];

const PRIVACY_OPTIONS: { value: MajorGroupPrivacy; label: string; desc: string }[] = [
  { value: "public", label: "Public", desc: "Anyone can discover and join" },
  { value: "request", label: "Request to Join", desc: "Discoverable but requires approval" },
  { value: "invite_only", label: "Invite Only", desc: "Hidden, members by invitation" },
];

const JOIN_METHODS: { value: MajorGroupJoinMethod; label: string }[] = [
  { value: "open", label: "Open (instant join)" },
  { value: "request", label: "Request (approval required)" },
  { value: "invite_only", label: "Invite only" },
  { value: "code", label: "Join code" },
];

type FormState = {
  name: string;
  description: string;
  type: MajorGroupType;
  privacy: MajorGroupPrivacy;
  join_method: MajorGroupJoinMethod;
  max_members: string;
  season_start: string;
  season_end: string;
};

const INITIAL: FormState = {
  name: "",
  description: "",
  type: "league",
  privacy: "public",
  join_method: "open",
  max_members: "",
  season_start: "",
  season_end: "",
};

const EMPTY_HANDICAP: HandicapRules = { mode: "allowance_pct", allowance_pct: "100", max_handicap: "" };

export default function CreateGroupClient() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Competition defaults state (optional step — can be skipped)
  const [defaultScoringModel, setDefaultScoringModel] = useState<CompetitionScoringModel | null>(null);
  const [defaultCompType, setDefaultCompType] = useState<CompetitionTypeV2 | null>(null);
  const [defaultHandicap, setDefaultHandicap] = useState<HandicapRules>(EMPTY_HANDICAP);
  const [defaultPointsModel, setDefaultPointsModel] = useState<string | null>(null);
  const [defaultStandingsContrib, setDefaultStandingsContrib] = useState<string | null>(null);
  const [defaultsEnabled, setDefaultsEnabled] = useState(false);

  const update = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const totalSteps = 5;

  const canNext = (): boolean => {
    if (step === 0) return form.name.trim().length > 0;
    return true;
  };

  const buildDefaultScoringPrefs = (): GroupScoringPrefs => {
    if (!defaultsEnabled) return {
      scoring_model: null,
      competition_type: null,
      handicap_rules: null,
      points_model: null,
      standings_contribution: null,
    };
    return {
      scoring_model: defaultScoringModel,
      competition_type: defaultCompType,
      handicap_rules: defaultScoringModel !== "gross"
        ? {
            mode: defaultHandicap.mode,
            allowance_pct: defaultHandicap.mode === "allowance_pct" ? (parseInt(defaultHandicap.allowance_pct, 10) || 100) : null,
            max_handicap: defaultHandicap.max_handicap ? parseInt(defaultHandicap.max_handicap, 10) : null,
          }
        : null,
      points_model: (defaultPointsModel as any) ?? null,
      standings_contribution: (defaultStandingsContrib as any) ?? null,
    };
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }
      const res = await fetch("/api/majors/groups", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          max_members: form.max_members ? parseInt(form.max_members, 10) : null,
          season_start: form.season_start || null,
          season_end: form.season_end || null,
          default_scoring_prefs: buildDefaultScoringPrefs(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create group"); return; }
      router.push(`/majors/groups/${json.group.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    /* Step 0: Name, Description, Type */
    <div key="step0" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Group Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Friday Fourball League"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          placeholder="What is this group about?"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Group Type</label>
        <div className="grid grid-cols-2 gap-2">
          {GROUP_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => update("type", t.value)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                form.type === t.value
                  ? "border-emerald-500 bg-emerald-900/50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
              }`}
            >
              <div className="text-xs font-semibold text-emerald-50">{t.label}</div>
              <div className="text-[10px] text-emerald-200/55">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>,

    /* Step 1: Privacy, Join method, Max members */
    <div key="step1" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Privacy</label>
        <div className="space-y-2">
          {PRIVACY_OPTIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => update("privacy", p.value)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                form.privacy === p.value
                  ? "border-emerald-500 bg-emerald-900/50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
              }`}
            >
              <div className="text-sm font-semibold text-emerald-50">{p.label}</div>
              <div className="text-[11px] text-emerald-200/55">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Join Method</label>
        <div className="space-y-2">
          {JOIN_METHODS.map((j) => (
            <button
              key={j.value}
              type="button"
              onClick={() => update("join_method", j.value)}
              className={`w-full rounded-xl border px-4 py-2 text-left transition-colors ${
                form.join_method === j.value
                  ? "border-emerald-500 bg-emerald-900/50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40"
              }`}
            >
              <div className="text-sm text-emerald-50">{j.label}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Max Members (optional)</label>
        <input
          type="number"
          value={form.max_members}
          onChange={(e) => update("max_members", e.target.value)}
          placeholder="Leave blank for unlimited"
          min={2}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
        />
      </div>
    </div>,

    /* Step 2: Competition Defaults (optional) */
    <div key="step2" className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-emerald-50 mb-1">Competition Defaults</div>
        <div className="text-[11px] text-emerald-200/55 mb-4">
          Set defaults that pre-fill when creating competitions in this group. All fields are optional and can be overridden per competition.
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-4 py-3">
        <span className="text-sm text-emerald-50">Set competition defaults</span>
        <button
          type="button"
          onClick={() => setDefaultsEnabled((v) => !v)}
          className={`relative w-11 h-6 rounded-full transition-colors ${defaultsEnabled ? "bg-emerald-600" : "bg-emerald-900/60"}`}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${defaultsEnabled ? "left-6" : "left-1"}`} />
        </button>
      </div>

      {defaultsEnabled && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Default Format</label>
            <div className="grid grid-cols-2 gap-2">
              {COMP_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => {
                    const next = defaultCompType === t.value ? null : t.value;
                    setDefaultCompType(next);
                    // Auto-couple scoring model with format
                    if (next) setDefaultScoringModel(FORMAT_DEFAULT_SCORING[next]);
                    else setDefaultScoringModel(null);
                  }}
                  className={`rounded-xl border px-3 py-2 text-left text-[11px] transition-colors ${
                    defaultCompType === t.value
                      ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                      : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {defaultCompType && !FORMAT_ALLOWS_SCORING_CHOICE(defaultCompType as any) ? (
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Default Scoring</label>
              <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-3 py-2 text-[11px] text-emerald-200/55">
                {defaultScoringModel === "stableford_points" ? "Stableford Points" : "Match Result"} — determined by format
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Default Scoring</label>
              <div className="grid grid-cols-2 gap-2">
                {SCORING_MODELS.filter((s) => s.value === "net" || s.value === "gross").map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setDefaultScoringModel(defaultScoringModel === s.value ? null : s.value)}
                    className={`rounded-xl border px-3 py-2 text-[11px] text-left transition-colors ${
                      defaultScoringModel === s.value
                        ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                        : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                    }`}
                  >
                    {s.shortLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          {defaultScoringModel && defaultScoringModel !== "gross" && (
            <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/55 font-semibold">Default Handicap Rules</div>
              <HandicapRulesEditor value={defaultHandicap} onChange={setDefaultHandicap} />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Default Points Model</label>
            <div className="grid grid-cols-2 gap-2">
              {POINTS_MODELS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setDefaultPointsModel(defaultPointsModel === p.value ? null : p.value)}
                  className={`rounded-xl border px-3 py-2 text-[11px] text-left transition-colors ${
                    defaultPointsModel === p.value
                      ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                      : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                  }`}
                >
                  {p.shortLabel}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Default Season Standings</label>
            <div className="grid grid-cols-3 gap-2">
              {STANDINGS_CONTRIBUTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setDefaultStandingsContrib(defaultStandingsContrib === s.value ? null : s.value)}
                  className={`rounded-xl border px-2 py-2 text-[10px] text-center transition-colors ${
                    defaultStandingsContrib === s.value
                      ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                      : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>,

    /* Step 3: Season dates */
    <div key="step3" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Season Start (optional)</label>
        <input
          type="date"
          value={form.season_start}
          onChange={(e) => update("season_start", e.target.value)}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Season End (optional)</label>
        <input
          type="date"
          value={form.season_end}
          onChange={(e) => update("season_end", e.target.value)}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
        />
      </div>
    </div>,

    /* Step 4: Confirm */
    <div key="step4" className="space-y-4">
      <div className="text-sm font-semibold text-emerald-50">Confirm Group Details</div>
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
        {[
          { label: "Name", value: form.name },
          { label: "Type", value: form.type },
          { label: "Privacy", value: form.privacy },
          { label: "Join", value: form.join_method },
          form.max_members ? { label: "Max members", value: form.max_members } : null,
          form.season_start ? { label: "Season start", value: form.season_start } : null,
          form.season_end ? { label: "Season end", value: form.season_end } : null,
          defaultsEnabled && defaultScoringModel ? { label: "Default scoring", value: defaultScoringModel } : null,
          defaultsEnabled && defaultCompType ? { label: "Default format", value: defaultCompType } : null,
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← {step === 0 ? "Back" : "Previous"}
        </button>
        <h1 className="text-base font-semibold text-[#f5e6b0]">Create Group</h1>
        <div className="text-[11px] text-emerald-200/55">
          {step + 1}/{totalSteps}
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex gap-1 mb-6">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? "bg-emerald-600" : "bg-emerald-900/50"
            }`}
          />
        ))}
      </div>

      {/* Step content */}
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

      {/* Navigation */}
      <div className="mt-6 pb-2">
        {step < totalSteps - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            {step === 2 && !defaultsEnabled ? "Skip" : "Next"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Group"}
          </button>
        )}
      </div>
    </div>
  );
}

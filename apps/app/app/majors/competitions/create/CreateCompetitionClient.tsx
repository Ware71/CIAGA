"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { EventTypeV2, EventScoringModel, EventPointsModel } from "@/lib/majors/types";
import {
  EVENT_TYPES,
  SCORING_MODELS,
  POINTS_MODELS,
  FORMAT_DEFAULT_SCORING,
  FORMAT_ALLOWS_SCORING_CHOICE,
  FEDEX_POINTS,
} from "@/lib/events/constants";
import { HandicapRulesEditor, type HandicapRules } from "@/components/competitions/HandicapRulesEditor";

const COMPETITION_FORMATS = EVENT_TYPES.filter((t) =>
  ["stroke", "stableford", "matchplay", "skins", "scramble", "bestball", "custom"].includes(t.value)
);

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function friendlyLabel(field: "format" | "scoring" | "points", value: string): string {
  if (field === "format") return EVENT_TYPES.find((t) => t.value === value)?.label ?? value;
  if (field === "scoring") return SCORING_MODELS.find((s) => s.value === value)?.shortLabel ?? value;
  if (field === "points") return POINTS_MODELS.find((p) => p.value === value)?.shortLabel ?? value;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type FormState = {
  name: string;
  description: string;
  typical_month: string;
  recur_annually: boolean;
};

const INITIAL: FormState = {
  name: "",
  description: "",
  typical_month: "",
  recur_annually: true,
};

const EMPTY_HANDICAP: HandicapRules = { mode: "allowance_pct", allowance_pct: "100", max_handicap: "" };

export default function CreateCompetitionClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get("group_id");

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [eventType, setEventTypeState] = useState<EventTypeV2>("stroke");
  const [scoringModel, setScoringModel] = useState<EventScoringModel>("net");
  const [numRounds, setNumRounds] = useState("1");
  const [handicap, setHandicap] = useState<HandicapRules>(EMPTY_HANDICAP);
  const [pointsModel, setPointsModel] = useState<EventPointsModel>("none");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prize pot defaults
  type PotDefault = { name: string; distribution_type: string; entry_fee_amount: string; is_mandatory: boolean; is_monetary: boolean };
  const [hasPrizePot, setHasPrizePot] = useState(false);
  const [potDefault, setPotDefault] = useState<PotDefault>({
    name: "",
    distribution_type: "winner_takes_all",
    entry_fee_amount: "",
    is_mandatory: true,
    is_monetary: true,
  });

  const update = (field: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const setEventType = (type: EventTypeV2) => {
    setEventTypeState(type);
    setScoringModel(FORMAT_DEFAULT_SCORING[type] ?? "net");
  };

  const totalSteps = 5;

  const canNext = (): boolean => {
    if (step === 0) return form.name.trim().length > 0;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }

      const templateSettings: Record<string, unknown> = { handicap_mode: handicap.mode };
      if (handicap.mode === "allowance_pct" || handicap.mode === "compare_against_lowest") {
        templateSettings.handicap_allowance_pct = parseInt(handicap.allowance_pct, 10) || 100;
      }
      if (handicap.mode !== "none" && handicap.max_handicap) {
        templateSettings.max_handicap = parseInt(handicap.max_handicap, 10);
      }

      const res = await fetch("/api/majors/competitions", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: groupId ?? null,
          name: form.name.trim(),
          description: form.description.trim() || null,
          recur_annually: form.recur_annually,
          typical_month: form.typical_month ? parseInt(form.typical_month, 10) : null,
          template_event_type: eventType,
          template_event_category: "round_based",
          template_scoring_model: scoringModel,
          template_points_model: pointsModel,
          template_num_rounds: parseInt(numRounds, 10) || 1,
          template_settings: templateSettings,
          default_prize_pots: hasPrizePot ? [{
            name: potDefault.name || `${form.name} Prize`,
            distribution_type: potDefault.distribution_type,
            entry_fee_amount: potDefault.entry_fee_amount ? parseFloat(potDefault.entry_fee_amount) : null,
            is_mandatory: potDefault.is_mandatory,
            is_monetary: potDefault.is_monetary,
          }] : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create competition"); return; }
      router.push(`/majors/competitions/${json.competition.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const allowsScoringChoice = FORMAT_ALLOWS_SCORING_CHOICE(eventType);
  const showHandicap = scoringModel !== "gross";
  const showRounds = !["matchplay", "skins", "scramble"].includes(eventType);

  const steps = [
    /* Step 0: Basic Info */
    <div key="step0" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Competition Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. The Club Masters"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={3}
          placeholder="Brief description of this recurring competition"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Typical Month (optional)</label>
        <select
          value={form.typical_month}
          onChange={(e) => update("typical_month", e.target.value)}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
        >
          <option value="">— No fixed month —</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={i + 1} value={String(i + 1)}>{m}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-emerald-50">Recur annually</div>
          <div className="text-[11px] text-emerald-200/55">Create a new season each year</div>
        </div>
        <button
          type="button"
          onClick={() => update("recur_annually", !form.recur_annually)}
          className={`relative h-6 w-11 rounded-full transition-colors ${form.recur_annually ? "bg-emerald-600" : "bg-emerald-900/60"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              form.recur_annually ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </div>,

    /* Step 1: Format & Scoring */
    <div key="step1" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Format</label>
        <div className="grid grid-cols-2 gap-2">
          {COMPETITION_FORMATS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setEventType(t.value as EventTypeV2)}
              className={`rounded-xl border px-3 py-2.5 text-left text-[11px] transition-colors ${
                eventType === t.value
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!allowsScoringChoice ? (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Scoring</label>
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-3 py-2 text-[11px] text-emerald-200/55">
            {scoringModel === "stableford_points" ? "Stableford Points" : "Match Result"} — determined by format
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Scoring</label>
          <div className="grid grid-cols-2 gap-2">
            {SCORING_MODELS.filter((s) => s.value === "net" || s.value === "gross").map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setScoringModel(s.value)}
                className={`rounded-xl border px-3 py-2.5 text-[11px] text-left transition-colors ${
                  scoringModel === s.value
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

      {showRounds && (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Number of Rounds</label>
          <input
            type="number"
            min={1}
            max={10}
            value={numRounds}
            onChange={(e) => setNumRounds(e.target.value)}
            className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
          />
        </div>
      )}

      {showHandicap && (
        <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/55 font-semibold">Handicap Rules</div>
          <HandicapRulesEditor value={handicap} onChange={setHandicap} />
        </div>
      )}
    </div>,

    /* Step 2: Points */
    <div key="step2" className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-emerald-50 mb-1">Points Model</div>
        <div className="text-[11px] text-emerald-200/55">
          How points are awarded to the season standings table.
        </div>
      </div>
      <div className="space-y-2">
        {POINTS_MODELS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPointsModel(p.value)}
            className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
              pointsModel === p.value
                ? "border-emerald-500 bg-emerald-900/50"
                : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
            }`}
          >
            <div className="text-sm font-semibold text-emerald-50">{p.label}</div>
            {p.desc && <div className="text-[11px] text-emerald-200/55 mt-0.5">{p.desc}</div>}

            {pointsModel === p.value && (
              <div className="mt-3 pt-3 border-t border-emerald-700/40">
                {p.value === "fedex_style" && (
                  <>
                    <div className="grid grid-cols-5 gap-x-2 gap-y-1">
                      {FEDEX_POINTS.map((pts, i) => (
                        <div key={i} className="text-[10px] text-emerald-200/70">
                          <span className="text-emerald-200/45">{ordinal(i + 1)}</span>{" "}
                          <span className="font-semibold text-emerald-100">{pts}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1.5 text-[10px] text-emerald-200/40">21st onwards — 0 pts</div>
                  </>
                )}
                {p.value === "position_based" && (
                  <div className="text-[10px] text-emerald-200/55">
                    Fixed point values per finishing position. Configure per season when you set it up.
                  </div>
                )}
                {p.value === "custom_table" && (
                  <div className="text-[10px] text-emerald-200/55">
                    Fully custom — define the points for each position when setting up each season.
                  </div>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>,

    /* Step 3: Prize Pot Defaults */
    <div key="step3" className="space-y-5">
      <div className="text-sm font-semibold text-emerald-50">Prize Pot</div>
      <p className="text-[12px] text-emerald-200/55">Define a default prize pot for each event in this competition. It will pre-fill when you create a new event instance.</p>

      {/* Toggle */}
      <div className="flex items-center justify-between rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-4 py-3">
        <div>
          <div className="text-sm text-emerald-50">Add event prize pot</div>
          <div className="text-[10px] text-emerald-200/50 mt-0.5">Pre-populate a pot for each event</div>
        </div>
        <button
          type="button"
          onClick={() => setHasPrizePot((v) => !v)}
          className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${hasPrizePot ? "bg-emerald-600" : "bg-emerald-900/60"}`}
        >
          <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${hasPrizePot ? "translate-x-5" : ""}`} />
        </button>
      </div>

      {hasPrizePot && (
        <div className="space-y-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-4 py-4">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/55">Pot Name</label>
            <input
              type="text"
              placeholder={`${form.name || "Event"} Prize`}
              value={potDefault.name}
              onChange={(e) => setPotDefault((p) => ({ ...p, name: e.target.value }))}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/30 focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/55">Distribution</label>
            <select
              value={potDefault.distribution_type}
              onChange={(e) => setPotDefault((p) => ({ ...p, distribution_type: e.target.value }))}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
            >
              <option value="winner_takes_all">Winner takes all</option>
              <option value="position_based">By finishing position (custom splits)</option>
              <option value="metric_weighted">Proportional to metric</option>
              <option value="metric_equal">Equal split among qualifiers</option>
              <option value="non_monetary">Non-cash prize</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/55">Entry Fee per Player (£)</label>
            <input
              type="number"
              min="0"
              step="0.50"
              placeholder="e.g. 10"
              value={potDefault.entry_fee_amount}
              onChange={(e) => setPotDefault((p) => ({ ...p, entry_fee_amount: e.target.value }))}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/30 focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-emerald-50">Mandatory</div>
              <div className="text-[10px] text-emerald-200/50 mt-0.5">Auto-enroll players on event join</div>
            </div>
            <button
              type="button"
              onClick={() => setPotDefault((p) => ({ ...p, is_mandatory: !p.is_mandatory }))}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${potDefault.is_mandatory ? "bg-emerald-600" : "bg-emerald-900/60"}`}
            >
              <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${potDefault.is_mandatory ? "translate-x-5" : ""}`} />
            </button>
          </div>
        </div>
      )}
    </div>,

    /* Step 4: Confirm */
    <div key="step4" className="space-y-4">
      <div className="text-sm font-semibold text-emerald-50">Confirm Competition Details</div>
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
        {[
          { label: "Name", value: form.name },
          form.description ? { label: "Description", value: form.description } : null,
          form.typical_month
            ? { label: "Typical month", value: MONTH_NAMES[parseInt(form.typical_month, 10) - 1] }
            : null,
          { label: "Recurs annually", value: form.recur_annually ? "Yes" : "No" },
          { label: "Format", value: friendlyLabel("format", eventType) },
          { label: "Scoring", value: friendlyLabel("scoring", scoringModel) },
          showRounds ? { label: "Rounds", value: numRounds } : null,
          { label: "Points model", value: friendlyLabel("points", pointsModel) },
        ]
          .filter(Boolean)
          .map((item) => (
            <div key={item!.label} className="flex justify-between text-sm">
              <span className="text-emerald-200/55">{item!.label}</span>
              <span className="text-emerald-50">{item!.value}</span>
            </div>
          ))}

        {showHandicap && (
          <div className="pt-2 mt-1 border-t border-emerald-800/40 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/45 mb-1">Handicap Rules</div>
            {[
              {
                label: "Mode",
                value: handicap.mode
                  .replace(/_/g, " ")
                  .replace(/\b\w/g, (c) => c.toUpperCase()),
              },
              (handicap.mode === "allowance_pct" || handicap.mode === "compare_against_lowest") &&
              handicap.allowance_pct
                ? { label: "Allowance", value: `${handicap.allowance_pct}%` }
                : null,
              handicap.max_handicap ? { label: "Max handicap", value: handicap.max_handicap } : null,
            ]
              .filter(Boolean)
              .map((item) => (
                <div key={item!.label} className="flex justify-between text-sm">
                  <span className="text-emerald-200/55">{item!.label}</span>
                  <span className="text-emerald-50">{item!.value}</span>
                </div>
              ))}
          </div>
        )}
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
        <h1 className="text-base font-semibold text-[#f5e6b0]">Create Competition</h1>
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
    </div>
  );
}

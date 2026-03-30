"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { CompetitionTypeV2, CompetitionScoringModel, CompetitionPointsModel, MajorGroup } from "@/lib/majors/types";

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

type FormState = {
  name: string;
  group_id: string;
  description: string;
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
};

const INITIAL: FormState = {
  name: "",
  group_id: "",
  description: "",
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
};

export default function CreateCompetitionClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedGroupId = searchParams.get("group_id") ?? "";

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({ ...INITIAL, group_id: preselectedGroupId });
  const [myGroups, setMyGroups] = useState<MajorGroup[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const update = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

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
      const res = await fetch("/api/majors/competitions", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description || null,
          group_id: form.group_id || null,
          competition_type: form.competition_type,
          format: form.format || null,
          competition_date: form.competition_date || null,
          entry_window_start: form.entry_window_start || null,
          entry_window_end: form.entry_window_end || null,
          rules_text: form.rules_text || null,
          scoring_model: form.scoring_model,
          points_model: form.points_model,
          num_rounds: parseInt(form.num_rounds, 10) || 1,
          standings_contribution: form.standings_contribution,
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
    /* Step 0: Name, Type */
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
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Type</label>
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
    </div>,

    /* Step 1: Group, Date */
    <div key="step1" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Parent Group (optional)</label>
        {myGroups.length > 0 ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => update("group_id", "")}
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

    /* Step 2: Entry window */
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
    </div>,

    /* Step 3: Scoring model */
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

    /* Step 4: Rules */
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
          { label: "Type", value: form.competition_type },
          { label: "Scoring", value: form.scoring_model },
          { label: "Points", value: form.points_model },
          { label: "Rounds", value: form.num_rounds },
          form.group_id ? { label: "Group", value: myGroups.find((g) => g.id === form.group_id)?.name ?? form.group_id } : null,
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
    </div>
  );
}

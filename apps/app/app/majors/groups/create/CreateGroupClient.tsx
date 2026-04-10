"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorGroupType, MajorGroupPrivacy, MajorGroupJoinMethod } from "@/lib/majors/types";

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

export default function CreateGroupClient() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const totalSteps = 3;

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
      const res = await fetch("/api/majors/groups", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          max_members: form.max_members ? parseInt(form.max_members, 10) : null,
          season_start: form.season_start || null,
          season_end: form.season_end || null,
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

    /* Step 2: Season dates */
    <div key="step2" className="space-y-5">
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

    /* Step 2 (final): Confirm */
    <div key="step3" className="space-y-4">
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
            Next
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

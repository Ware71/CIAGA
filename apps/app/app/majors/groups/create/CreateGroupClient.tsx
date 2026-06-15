"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { InvitePlayerSheet } from "@/app/majors/groups/InvitePlayerSheet";
import type {
  MajorGroupType,
  MajorGroupPrivacy,
  MajorGroupJoinMethod,
  GroupScoringPrefs,
  EventTypeV2,
  EventScoringModel,
} from "@/lib/majors/types";
import { SCORING_MODELS, POINTS_MODELS, EVENT_TYPES, EVENT_TYPE_LABELS, FORMAT_DEFAULT_SCORING, FORMAT_ALLOWS_SCORING_CHOICE, FEDEX_POINTS } from "@/lib/events/constants";
import { HandicapRulesEditor, type HandicapRules } from "@/components/competitions/HandicapRulesEditor";

const GROUP_TYPES: { value: MajorGroupType; label: string; desc: string }[] = [
  { value: "league",             label: "Strokeplay League",  desc: "Multiple events that roll up to a points-based league table." },
  { value: "matchplay_series",   label: "Matchplay League",   desc: "League table where points are awarded for matchplay results." },
  { value: "matchplay_knockout", label: "Matchplay Knockout", desc: "A knockout bracket — players are eliminated after losing." },
  { value: "major_series",       label: "Major Series",       desc: "Recurring signature events that post to a shared leaderboard." },
  { value: "oneoff",             label: "Tournament",         desc: "A standalone signature event with its own container." },
];

const ACCESS_OPTIONS: { value: string; label: string; desc: string; privacy: MajorGroupPrivacy; join_method: MajorGroupJoinMethod }[] = [
  { value: "open",    label: "Open",            desc: "Anyone can find and join instantly.",           privacy: "public",      join_method: "open" },
  { value: "request", label: "Request to Join", desc: "Discoverable, but joining requires approval.",  privacy: "request",     join_method: "request" },
  { value: "private", label: "Private",         desc: "Join by invitation or shared code only.",       privacy: "invite_only", join_method: "code" },
];

const MATCHPLAY_GROUP_TYPES = new Set<MajorGroupType>(["matchplay_series", "matchplay_knockout"]);

function getFormatsForGroupType(type: MajorGroupType) {
  if (MATCHPLAY_GROUP_TYPES.has(type))
    return EVENT_TYPES.filter((t) => t.value === "matchplay");
  return EVENT_TYPES.filter((t) =>
    ["stroke", "stableford", "skins", "scramble", "bestball", "custom"].includes(t.value)
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

type FormState = {
  name: string;
  description: string;
  type: MajorGroupType;
  privacy: MajorGroupPrivacy;
  join_method: MajorGroupJoinMethod;
  max_members: string;
};

type SeasonDraft = { name: string; start_date: string; end_date: string; mode: "annual" | "custom" };

const currentYear = new Date().getFullYear();

const INITIAL: FormState = {
  name: "",
  description: "",
  type: "league",
  privacy: "public",
  join_method: "open",
  max_members: "",
};

const EMPTY_HANDICAP: HandicapRules = { mode: "allowance_pct", allowance_pct: "100", max_handicap: "" };

function addNextSeason(seasons: SeasonDraft[]): SeasonDraft {
  const last = seasons.at(-1)!;
  const startMs = new Date(last.start_date).getTime();
  const endMs   = new Date(last.end_date).getTime();
  const durationMs = endMs - startMs + 86_400_000; // inclusive day
  const nextStart = new Date(startMs + durationMs);
  const nextEnd   = new Date(endMs   + durationMs);
  const sy = nextStart.getFullYear(), ey = nextEnd.getFullYear();
  const name = sy === ey
    ? `${sy} Season`
    : `${String(sy).slice(2)}/${String(ey).slice(2)} Season`;
  return {
    name,
    start_date: nextStart.toISOString().slice(0, 10),
    end_date:   nextEnd.toISOString().slice(0, 10),
    mode: sy === ey ? "annual" : "custom",
  };
}

function friendlyLabel(field: "type" | "access" | "format" | "points", value: string): string {
  if (field === "type")   return GROUP_TYPES.find((t) => t.value === value)?.label ?? value;
  if (field === "access") return ACCESS_OPTIONS.find((a) => a.privacy === value)?.label ?? value;
  if (field === "format") return EVENT_TYPE_LABELS[value as keyof typeof EVENT_TYPE_LABELS] ?? value;
  if (field === "points") return POINTS_MODELS.find((p) => p.value === value)?.label ?? value;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CreateGroupClient() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Competition defaults state
  const [defaultScoringModel, setDefaultScoringModel] = useState<EventScoringModel | null>(null);
  const [defaultCompType, setDefaultCompType] = useState<EventTypeV2 | null>(null);
  const [defaultHandicap, setDefaultHandicap] = useState<HandicapRules>(EMPTY_HANDICAP);
  const [defaultPointsModel, setDefaultPointsModel] = useState<string | null>(null);

  // Seasons state
  const [seasons, setSeasons] = useState<SeasonDraft[]>([
    { name: `${currentYear} Season`, start_date: `${currentYear}-01-01`, end_date: `${currentYear}-12-31`, mode: "annual" },
  ]);

  // Post-creation invite state
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [invitedMembers, setInvitedMembers] = useState<{ id: string; name: string | null }[]>([]);

  const update = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const setAccess = (opt: typeof ACCESS_OPTIONS[number]) => {
    setForm((prev) => ({ ...prev, privacy: opt.privacy, join_method: opt.join_method }));
  };

  const setGroupType = (type: MajorGroupType) => {
    update("type", type);
    if (MATCHPLAY_GROUP_TYPES.has(type)) {
      setDefaultCompType("matchplay");
      setDefaultScoringModel("match_result");
    } else if (defaultCompType === "matchplay") {
      setDefaultCompType(null);
      setDefaultScoringModel(null);
    }
  };

  const updateSeason = (i: number, field: keyof SeasonDraft, value: string) => {
    setSeasons((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
  };

  const removeSeason = (i: number) => {
    setSeasons((prev) => prev.filter((_, idx) => idx !== i));
  };

  const totalSteps = 6;

  const canNext = (): boolean => {
    if (step === 0) return form.name.trim().length > 0;
    return true;
  };

  const buildDefaultScoringPrefs = (): GroupScoringPrefs => {
    const hasDefaults = defaultCompType !== null || defaultPointsModel !== null;
    return {
      scoring_model: defaultScoringModel,
      competition_type: defaultCompType,
      handicap_rules: defaultScoringModel && defaultScoringModel !== "gross"
        ? {
            mode: defaultHandicap.mode,
            allowance_pct: defaultHandicap.mode === "allowance_pct" ? (parseInt(defaultHandicap.allowance_pct, 10) || 100) : null,
            max_handicap: defaultHandicap.max_handicap ? parseInt(defaultHandicap.max_handicap, 10) : null,
          }
        : null,
      points_model: (defaultPointsModel as any) ?? null,
      standings_contribution: hasDefaults ? "both" : null,
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
          name: form.name,
          description: form.description,
          type: form.type,
          privacy: form.privacy,
          join_method: form.join_method,
          max_members: form.max_members ? parseInt(form.max_members, 10) : null,
          seasons: seasons.map(({ name, start_date, end_date }) => ({ name, start_date, end_date })),
          default_scoring_prefs: buildDefaultScoringPrefs(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create group"); return; }
      setCreatedGroupId(json.group.id);
      setStep((s) => s + 1); // advance to invite step
    } finally {
      setSubmitting(false);
    }
  };

  const activeAccess = ACCESS_OPTIONS.find((a) => a.privacy === form.privacy) ?? ACCESS_OPTIONS[0];
  const availableFormats = getFormatsForGroupType(form.type);

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
        <div className="space-y-2">
          {GROUP_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setGroupType(t.value)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                form.type === t.value
                  ? "border-emerald-500 bg-emerald-900/50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
              }`}
            >
              <div className="text-sm font-semibold text-emerald-50">{t.label}</div>
              <div className="text-[11px] text-emerald-200/55">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>,

    /* Step 1: Access & Max members */
    <div key="step1" className="space-y-5">
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Access</label>
        <div className="space-y-2">
          {ACCESS_OPTIONS.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setAccess(a)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                activeAccess.value === a.value
                  ? "border-emerald-500 bg-emerald-900/50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
              }`}
            >
              <div className="text-sm font-semibold text-emerald-50">{a.label}</div>
              <div className="text-[11px] text-emerald-200/55">{a.desc}</div>
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

    /* Step 2: Competition Defaults */
    <div key="step2" className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-emerald-50 mb-1">Competition Defaults</div>
        <div className="text-[11px] text-emerald-200/55">
          Pre-fill settings when creating competitions in this group. All optional — override per competition anytime.
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Default Format</label>
        <div className="grid grid-cols-2 gap-2">
          {availableFormats.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                const next = defaultCompType === t.value ? null : t.value;
                setDefaultCompType(next);
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
        <div className="space-y-2">
          {POINTS_MODELS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setDefaultPointsModel(defaultPointsModel === p.value ? null : p.value)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                defaultPointsModel === p.value
                  ? "border-emerald-500 bg-emerald-900/50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
              }`}
            >
              <div className="text-sm font-semibold text-emerald-50">{p.label}</div>
              {p.desc && <div className="text-[11px] text-emerald-200/55 mt-0.5">{p.desc}</div>}

              {/* Points preview — shown when this model is selected */}
              {defaultPointsModel === p.value && (
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
                      Fixed point values per finishing position. Set when creating each competition.
                    </div>
                  )}
                  {p.value === "custom_table" && (
                    <div className="text-[10px] text-emerald-200/55">
                      Fully custom — you define the points for each position when creating each competition.
                    </div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,

    /* Step 3: Seasons */
    <div key="step3" className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-emerald-50 mb-1">Seasons</div>
        <div className="text-[11px] text-emerald-200/55">
          Define the season windows for this group. Add future seasons now or later.
        </div>
      </div>

      <div className="space-y-3">
        {seasons.map((s, i) => (
          <div key={i} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 p-3 space-y-3">
            {/* Name + remove */}
            <div className="flex items-center justify-between">
              <input
                type="text"
                value={s.name}
                onChange={(e) => updateSeason(i, "name", e.target.value)}
                placeholder="Season name"
                className="flex-1 bg-transparent text-sm font-semibold text-emerald-50 placeholder:text-emerald-100/30 focus:outline-none"
              />
              {seasons.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSeason(i)}
                  className="ml-2 text-[11px] text-emerald-400/60 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>

            {/* Annual / Custom toggle */}
            <div className="flex gap-1">
              {(["annual", "custom"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updateSeason(i, "mode", m)}
                  className={`rounded-lg border px-3 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                    s.mode === m
                      ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                      : "border-emerald-900/50 bg-transparent text-emerald-200/50"
                  }`}
                >
                  {m === "annual" ? "Annual" : "Custom dates"}
                </button>
              ))}
            </div>

            {/* Date inputs */}
            {s.mode === "annual" ? (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Year</div>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={parseInt(s.start_date.slice(0, 4), 10)}
                  onChange={(e) => {
                    const y = e.target.value.padStart(4, "0");
                    updateSeason(i, "start_date", `${y}-01-01`);
                    updateSeason(i, "end_date", `${y}-12-31`);
                  }}
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Start date</div>
                  <input
                    type="date"
                    value={s.start_date}
                    onChange={(e) => updateSeason(i, "start_date", e.target.value)}
                    className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">End date</div>
                  <input
                    type="date"
                    value={s.end_date}
                    onChange={(e) => updateSeason(i, "end_date", e.target.value)}
                    className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setSeasons((prev) => [...prev, addNextSeason(prev)])}
        className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        + Add season
      </button>
    </div>,

    /* Step 4: Confirm */
    <div key="step4" className="space-y-4">
      <div className="text-sm font-semibold text-emerald-50">Confirm Group Details</div>
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
        {[
          { label: "Name", value: form.name },
          { label: "Type", value: friendlyLabel("type", form.type) },
          { label: "Access", value: friendlyLabel("access", form.privacy) },
          form.max_members ? { label: "Max members", value: form.max_members } : null,
          defaultCompType ? { label: "Default format", value: friendlyLabel("format", defaultCompType) } : null,
          defaultPointsModel ? { label: "Default points", value: friendlyLabel("points", defaultPointsModel) } : null,
        ]
          .filter(Boolean)
          .map((item) => (
            <div key={item!.label} className="flex justify-between text-sm">
              <span className="text-emerald-200/55">{item!.label}</span>
              <span className="text-emerald-50">{item!.value}</span>
            </div>
          ))}

        {/* Seasons summary */}
        <div className="pt-2 mt-1 border-t border-emerald-800/40 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/45 mb-1">Seasons</div>
          {seasons.map((s, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-emerald-200/55">{s.name}</span>
              <span className="text-emerald-50 text-[11px]">{s.start_date} – {s.end_date}</span>
            </div>
          ))}
        </div>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
    </div>,

    /* Step 5: Invite Members */
    <div key="step5" className="space-y-4">
      <div className="text-sm font-semibold text-emerald-50">Group Created! Invite Members</div>
      <p className="text-[12px] text-emerald-200/55">Search for players to invite. They&apos;ll see a notification on their Majors Hub.</p>

      {createdGroupId && (
        <InvitePlayerSheet
          groupId={createdGroupId}
          excludedProfileIds={new Set(invitedMembers.map((m) => m.id))}
          onInvited={(profile) => setInvitedMembers((prev) => [...prev, profile])}
        />
      )}
    </div>,
  ];

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => step === 0 ? router.back() : step === totalSteps - 1 && createdGroupId ? router.push(`/majors/groups/${createdGroupId}`) : setStep((s) => s - 1)}
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
        {step === totalSteps - 1 ? (
          // Last step (Invite Members) — Done navigates to the group
          <button
            type="button"
            onClick={() => createdGroupId && router.push(`/majors/groups/${createdGroupId}`)}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600"
          >
            {invitedMembers.length > 0 ? "Done" : "Skip & Go to Group"}
          </button>
        ) : step === totalSteps - 2 ? (
          // Confirm step — creates the group
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Group"}
          </button>
        ) : (
          // Earlier steps — advance
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canNext()}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

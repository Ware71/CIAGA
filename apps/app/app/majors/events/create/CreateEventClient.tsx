"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  EventTypeV2,
  EventScoringModel,
  EventPointsModel,
  EventCategory,
  Competition,
  CompetitionEventTemplate,
  MajorGroup,
} from "@/lib/majors/types";
import type { PlayingHandicapMode } from "@/components/rounds/PlayingHandicapSettings";
import { EVENT_CATEGORIES, EVENT_TYPES, SCORING_MODELS, POINTS_MODELS, FORMAT_DEFAULT_SCORING, FORMAT_ALLOWS_SCORING_CHOICE, FEDEX_POINTS } from "@/lib/events/constants";
import { HandicapRulesEditor } from "@/components/competitions/HandicapRulesEditor";
import { CoursePickerModal } from "@/components/rounds/CoursePickerModal";

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
  event_category: EventCategory;
  event_type: EventTypeV2;
  format: string;
  course_id: string;
  course_name: string;
  event_date: string;
  entry_window_start: string;
  entry_window_end: string;
  rules_text: string;
  scoring_model: EventScoringModel;
  points_model: EventPointsModel;
  points_table: Record<string, number>;
  num_rounds: string;
  standings_contribution: string;
  // Competition (series) fields
  competition_id: string;
  competition_event_template_id: string;
  event_year: string;
  // Aggregate config
  aggregate_source: AggregateSource;
  aggregate_top_n: string;
  aggregate_include_round: boolean;
  // Handicap rules
  handicap_mode: PlayingHandicapMode;
  handicap_allowance_pct: string;
  handicap_max: string;
  // Default tees (applied to rounds on creation)
  default_tee_male_id: string;
  default_tee_female_id: string;
  // Leaderboard freeze / ceremony reveal
  freeze_enabled: boolean;
  freeze_last_holes: string;
  freeze_scope: "all" | "top_x";
  freeze_top_x: string;
  freeze_auto_reveal: boolean;
  reveal_style: "none" | "animated" | "suspense" | "rapid" | "podium";
  reveal_top_x: string;
};

const INITIAL: FormState = {
  name: "",
  group_id: "",
  description: "",
  event_category: "round_based",
  event_type: "stroke",
  format: "",
  course_id: "",
  course_name: "",
  event_date: "",
  entry_window_start: "",
  entry_window_end: "",
  rules_text: "",
  scoring_model: "net",
  points_model: "none",
  points_table: {},
  num_rounds: "1",
  standings_contribution: "season",
  competition_id: "",
  competition_event_template_id: "",
  event_year: String(new Date().getFullYear()),
  aggregate_source: "group_standings",
  aggregate_top_n: "",
  aggregate_include_round: false,
  handicap_mode: "allowance_pct",
  handicap_allowance_pct: "100",
  handicap_max: "",
  default_tee_male_id: "",
  default_tee_female_id: "",
  // Leaderboard freeze / ceremony reveal
  freeze_enabled: false,
  freeze_last_holes: "",
  freeze_scope: "all",
  freeze_top_x: "",
  freeze_auto_reveal: false,
  reveal_style: "none",
  reveal_top_x: "",
};



function PointsTableEditor({
  pointsModel,
  pointsTable,
  onChange,
}: {
  pointsModel: EventPointsModel;
  pointsTable: Record<string, number>;
  onChange: (table: Record<string, number>) => void;
}) {
  if (pointsModel === "none") return null;

  if (pointsModel === "fedex_style") {
    return (
      <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-emerald-200/55 font-semibold">FedEx-Style Points (read-only)</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {FEDEX_POINTS.map((pts, i) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <span className="text-[11px] text-emerald-200/60">
                {i + 1}{i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}
              </span>
              <span className="text-[11px] font-semibold text-[#f5e6b0]">{pts}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // position_based or custom_table — editable
  const rows = Array.from({ length: 20 }, (_, i) => i + 1);

  function handleChange(pos: number, raw: string) {
    const val = raw === "" ? 0 : parseInt(raw, 10);
    onChange({ ...pointsTable, [String(pos)]: isNaN(val) ? 0 : val });
  }

  return (
    <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 p-4 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-emerald-200/55 font-semibold">Points by Position</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {rows.map((pos) => (
          <div key={pos} className="flex items-center justify-between py-0.5">
            <span className="text-[11px] text-emerald-200/60 w-8 shrink-0">
              {pos}{pos === 1 ? "st" : pos === 2 ? "nd" : pos === 3 ? "rd" : "th"}
            </span>
            <input
              type="number"
              min={0}
              value={pointsTable[String(pos)] ?? ""}
              onChange={(e) => handleChange(pos, e.target.value)}
              placeholder="0"
              className="w-16 rounded-lg border border-emerald-900/60 bg-[#042713] px-2 py-1 text-[11px] text-emerald-50 placeholder:text-emerald-100/30 focus:outline-none focus:border-emerald-600 text-right"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const REVEAL_MODES = [
  { value: "none",     label: "Instant",          desc: "Results appear immediately" },
  { value: "animated", label: "Classic",           desc: "Sequential reveal, 1.5 s each" },
  { value: "suspense", label: "Suspense",          desc: "Cards flip one by one — slow & dramatic" },
  { value: "rapid",    label: "Rapid fire",        desc: "Fast cascade through the field" },
  { value: "podium",   label: "Dramatic Podium",   desc: "Floating field, podium pop reveal" },
] as const;

const PREVIEW_TIMING: Record<string, { countdown: number; interval: number }> = {
  animated: { countdown: 2000, interval: 800 },
  suspense: { countdown: 2500, interval: 1400 },
  rapid:    { countdown: 1000, interval: 300 },
  podium:   { countdown: 0,    interval: 900 },
};

const PREVIEW_ROWS = [
  { pos: 3, name: "M. Jones", initials: "MJ", score: 74 },
  { pos: 2, name: "S. Park",  initials: "SP", score: 72 },
  { pos: 1, name: "J. Smith", initials: "JS", score: 70 },
];

const SUSPENSE_LABELS = ["Get ready…", "Almost there…", "Here we go…"];

function SuspensePreviewCard({ row, flipped }: { row: typeof PREVIEW_ROWS[0]; flipped: boolean }) {
  const isWinner = row.pos === 1;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
      isWinner && flipped ? "border-[#f5e6b0]/50 bg-[#f5e6b0]/10" : "border-emerald-900/50 bg-[#0b3b21]/70"
    }`}>
      <span className="w-5 text-center text-[10px] font-extrabold text-[#f5e6b0]/70">
        {isWinner && flipped ? "🏆" : row.pos}
      </span>
      <AnimatePresence mode="wait">
        {!flipped ? (
          <motion.div key="hidden" exit={{ rotateY: 90 }} transition={{ duration: 0.2 }} className="flex flex-1 items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] text-emerald-200/40 shrink-0">?</div>
            <span className="flex-1 text-[11px] text-emerald-200/30 tracking-widest">— — —</span>
            <span className="text-[10px] text-[#f5e6b0]/25">??</span>
          </motion.div>
        ) : (
          <motion.div key="shown" initial={{ rotateY: -90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.3, type: "spring", stiffness: 280, damping: 24 }} className="flex flex-1 items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200 shrink-0">{row.initials}</div>
            <span className={`flex-1 text-[11px] font-semibold truncate ${isWinner ? "text-[#f5e6b0]" : "text-emerald-50"}`}>{row.name}</span>
            <span className={`text-[10px] font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0]" : "text-[#f5e6b0]/80"}`}>{row.score}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const PODIUM_PREVIEW_POSITIONS = [
  {
    pos: 2 as const, initials: "SP", name: "S. Park",  score: "72",
    gradient: "linear-gradient(180deg, #94a3b8 0%, #64748b 40%, #334155 100%)",
    ring: "ring-slate-300", text: "text-slate-200", h: 52, label: "2",
    bLeft: "16%", bTop: "8%",  bSize: "w-9 h-9",  pulsePeak: 1.25, pulseDur: 3.2,
  },
  {
    pos: 1 as const, initials: "JS", name: "J. Smith", score: "-2",
    gradient: "linear-gradient(180deg, #c9a227 0%, #9a7b1a 40%, #6b5112 100%)",
    ring: "ring-[#f5e6b0]", text: "text-[#f5e6b0]", h: 70, label: "1",
    bLeft: "44%", bTop: "4%",  bSize: "w-11 h-11", pulsePeak: 1.35, pulseDur: 2.7,
  },
  {
    pos: 3 as const, initials: "MJ", name: "M. Jones", score: "+4",
    gradient: "linear-gradient(180deg, #b45309 0%, #92400e 40%, #5c2d0a 100%)",
    ring: "ring-amber-600", text: "text-amber-200", h: 38, label: "3",
    bLeft: "68%", bTop: "18%", bSize: "w-8 h-8",  pulsePeak: 1.2,  pulseDur: 3.8,
  },
] as const;

function PodiumPreview() {
  const [popped, setPopped] = useState<number[]>([]);
  const [growing, setGrowing] = useState<number | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    setPopped([]);
    setGrowing(null);
    const order: number[] = Math.random() < 0.5 ? [2, 3, 1] : [3, 2, 1];
    const timers: ReturnType<typeof setTimeout>[] = [];

    let t = 600;
    order.forEach((pos, i) => {
      if (i > 0) t += pos === 1 ? 1400 : 600;
      const captured = t;
      timers.push(setTimeout(() => {
        setGrowing(pos);
        timers.push(setTimeout(() => { setPopped((p) => [...p, pos]); setGrowing(null); }, 520));
      }, captured));
    });

    timers.push(setTimeout(() => setReplayKey((k) => k + 1), t + 2500));
    return () => timers.forEach(clearTimeout);
  }, [replayKey]);

  return (
    <div className="relative w-full" style={{ height: 200 }}>
      {/* Floating bubbles */}
      {PODIUM_PREVIEW_POSITIONS.map(({ pos, initials, bLeft, bTop, bSize, pulsePeak, pulseDur }) => {
        const isPopped = popped.includes(pos);
        const isGrowing = growing === pos;
        if (isPopped && !isGrowing) return null;
        return (
          <div key={pos}>
            <motion.div
              style={{ position: "absolute", left: bLeft, top: bTop, originX: "50%", originY: "50%" }}
              animate={
                isGrowing
                  ? { scale: [1, 3.5, 0], opacity: [1, 1, 0] }
                  : { scale: [1, pulsePeak, 0.88, pulsePeak * 0.9, 1] }
              }
              transition={
                isGrowing
                  ? { duration: 0.85, times: [0, 0.6, 1], ease: "easeIn" }
                  : { duration: pulseDur, repeat: Infinity, ease: "easeInOut" }
              }
              className={`${bSize} rounded-full border border-emerald-700/50 bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200`}
            >
              {initials}
            </motion.div>
            {isGrowing && (
              <motion.div
                style={{ position: "absolute", left: bLeft, top: bTop, originX: "50%", originY: "50%", pointerEvents: "none" }}
                initial={{ scale: 1, opacity: 0.8 }}
                animate={{ scale: 5, opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className={`${bSize} rounded-full border border-emerald-400/60`}
              />
            )}
          </div>
        );
      })}

      {/* Podium */}
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-1 px-4">
        {PODIUM_PREVIEW_POSITIONS.map(({ pos, initials, name, score, gradient, ring, text, h, label }) => {
          const isRevealed = popped.includes(pos);
          return (
            <div key={pos} className="flex flex-col items-center" style={{ width: "30%" }}>
              {/* Avatar */}
              <div className="relative z-10 mb-[-10px]">
                <AnimatePresence>
                  {isRevealed && (
                    <motion.div
                      initial={{ opacity: 0, y: -30, scale: 0.3 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 320, damping: 22 }}
                      className={`ring-1 ${ring} rounded-full shadow-lg`}
                    >
                      <div className="w-7 h-7 rounded-full bg-emerald-900/60 grid place-items-center text-[8px] font-bold text-emerald-200">
                        {initials}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                {!isRevealed && <div className="w-7 h-7 opacity-0" />}
              </div>

              {/* Podium body */}
              <div
                className="w-full rounded-t relative overflow-hidden"
                style={{ background: gradient, height: h }}
              >
                <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />
                <AnimatePresence>
                  {isRevealed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4, duration: 0.3 }}
                      className={`absolute inset-x-0 top-3 text-center text-[8px] font-bold leading-tight px-0.5 truncate ${text}`}
                    >
                      {name}
                    </motion.span>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {isRevealed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.6, duration: 0.3 }}
                      className={`absolute inset-x-0 top-[22px] text-center text-[9px] font-extrabold ${text}`}
                    >
                      {score}
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className={`absolute bottom-0.5 inset-x-0 text-center text-xl font-black ${text} opacity-20 select-none`}>
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RevealModePreview({ mode }: { mode: "animated" | "suspense" | "rapid" | "podium" }) {
  const [phase, setPhase] = useState<"countdown" | "reveal" | "pause">("countdown");
  const [revealedCount, setRevealedCount] = useState(0);
  const [flippedCount, setFlippedCount] = useState(0);
  const [labelIdx, setLabelIdx] = useState(0);

  const { countdown, interval } = PREVIEW_TIMING[mode];

  useEffect(() => {
    setPhase("countdown");
    setRevealedCount(0);
    setFlippedCount(0);
    setLabelIdx(0);
  }, [mode]);

  // Suspense label cycling
  useEffect(() => {
    if (phase !== "countdown" || mode !== "suspense") return;
    const t = setInterval(() => setLabelIdx((i) => Math.min(i + 1, SUSPENSE_LABELS.length - 1)), 800);
    return () => clearInterval(t);
  }, [phase, mode]);

  // Countdown → reveal (non-podium only)
  useEffect(() => {
    if (mode === "podium" || phase !== "countdown") return;
    const t = setTimeout(() => { setPhase("reveal"); }, countdown);
    return () => clearTimeout(t);
  }, [phase, countdown, mode]);

  // Reveal tick
  useEffect(() => {
    if (mode === "podium" || phase !== "reveal") return;
    if (revealedCount >= PREVIEW_ROWS.length) {
      const t = setTimeout(() => {
        setPhase("pause");
        setTimeout(() => {
          setPhase("countdown");
          setRevealedCount(0);
          setFlippedCount(0);
          setLabelIdx(0);
        }, 1200);
      }, 800);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealedCount((c) => c + 1), interval);
    return () => clearTimeout(t);
  }, [mode, phase, revealedCount, interval]);

  // Suspense flip: 1 s after each card appears
  useEffect(() => {
    if (mode !== "suspense" || phase !== "reveal") return;
    if (flippedCount >= revealedCount) return;
    const t = setTimeout(() => setFlippedCount((c) => c + 1), 700);
    return () => clearTimeout(t);
  }, [mode, phase, revealedCount, flippedCount]);

  const visibleRows = PREVIEW_ROWS.slice(0, revealedCount);

  const springProps = mode === "rapid"
    ? { type: "spring" as const, stiffness: 400, damping: 28 }
    : { type: "spring" as const, stiffness: 260, damping: 22 };

  return (
    <div className="rounded-xl border border-emerald-900/40 bg-[#051a0d]/80 overflow-hidden" style={{ height: 210 }}>
      <div className="text-[9px] uppercase tracking-wider text-emerald-200/30 px-3 pt-2 pb-1">Preview</div>
      <div className="flex flex-col items-center justify-center px-3" style={{ height: 178 }}>

        {/* Podium preview */}
        {mode === "podium" && <PodiumPreview />}

        {/* All other modes */}
        {mode !== "podium" && (
          <AnimatePresence mode="wait">
            {phase === "countdown" && (
              <motion.div key="cd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center space-y-2">
                {mode === "suspense" ? (
                  <>
                    <AnimatePresence mode="wait">
                      <motion.p key={labelIdx} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="text-[#f5e6b0] text-xs font-bold tracking-widest uppercase">
                        {SUSPENSE_LABELS[labelIdx]}
                      </motion.p>
                    </AnimatePresence>
                    <div className="flex justify-center gap-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-[#f5e6b0]"
                          animate={{ opacity: [0.15, 1, 0.15], scale: [0.8, 1.2, 0.8] }}
                          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.4 }} />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[#f5e6b0] text-xs font-bold tracking-widest uppercase">
                      {mode === "rapid" ? "Stand by…" : "Results incoming"}
                    </p>
                    <div className="flex justify-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                          animate={{ opacity: [0.2, 1, 0.2] }}
                          transition={{ duration: mode === "rapid" ? 0.5 : 1.0, repeat: Infinity, delay: i * 0.3 }} />
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {(phase === "reveal" || phase === "pause") && (
              <motion.div key="rv" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-1.5">
                <AnimatePresence>
                  {mode === "suspense"
                    ? visibleRows.map((row, i) => (
                        <SuspensePreviewCard key={row.pos} row={row} flipped={i < flippedCount} />
                      ))
                    : visibleRows.map((row) => {
                        const isWinner = row.pos === 1;
                        return (
                          <motion.div key={row.pos}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={springProps}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                              isWinner ? "border-[#f5e6b0]/50 bg-[#f5e6b0]/10" : "border-emerald-900/50 bg-[#0b3b21]/70"
                            }`}
                          >
                            <span className="w-5 text-center text-[10px] font-extrabold text-[#f5e6b0]/70">
                              {isWinner ? "🏆" : row.pos}
                            </span>
                            <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200 shrink-0">
                              {row.initials}
                            </div>
                            <span className={`flex-1 text-[11px] font-semibold truncate ${isWinner ? "text-[#f5e6b0]" : "text-emerald-50"}`}>
                              {row.name}
                            </span>
                            <span className={`text-[10px] font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0]" : "text-[#f5e6b0]/80"}`}>
                              {row.score}
                            </span>
                          </motion.div>
                        );
                      })}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function LeaderboardFreezeSection({
  form,
  update,
}: {
  form: FormState;
  update: (k: keyof FormState, v: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasConfig = form.freeze_enabled;
  return (
    <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] uppercase tracking-wider text-emerald-200/65">Ceremony Freeze</span>
        <span className="text-[10px] text-emerald-100/50">{hasConfig ? "Configured" : "Optional"} {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Enable toggle */}
          <button
            type="button"
            onClick={() => update("freeze_enabled", !form.freeze_enabled)}
            className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
              form.freeze_enabled
                ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                : "border-emerald-900/50 bg-[#042713] text-emerald-200/60"
            }`}
          >
            <div className="font-semibold">Hide results for ceremony</div>
            <div className="text-[10px] text-emerald-200/50 mt-0.5">Freeze leaderboard before players finish</div>
          </button>

          {form.freeze_enabled && (
            <>
              {/* How many holes to hide */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-emerald-200/55">Hide last ___ holes</label>
                <input
                  type="number"
                  min={1}
                  max={17}
                  value={form.freeze_last_holes}
                  onChange={(e) => update("freeze_last_holes", e.target.value)}
                  placeholder="e.g. 5"
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
                />
                <p className="text-[10px] text-emerald-100/40">
                  Scores through the earlier holes remain visible. Final holes are hidden until the reveal.
                </p>
              </div>

              {/* Scope */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-emerald-200/55">Who is hidden?</label>
                <div className="flex gap-1.5">
                  {(["all", "top_x"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => update("freeze_scope", v)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-xs transition-colors ${
                        form.freeze_scope === v
                          ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                          : "border-emerald-900/50 bg-[#042713] text-emerald-200/60"
                      }`}
                    >
                      {v === "all" ? "Entire field" : "Top X only"}
                    </button>
                  ))}
                </div>
                {form.freeze_scope === "top_x" && (
                  <input
                    type="number"
                    min={1}
                    value={form.freeze_top_x}
                    onChange={(e) => update("freeze_top_x", e.target.value)}
                    placeholder="How many top positions to hide"
                    className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
                  />
                )}
              </div>

              {/* Auto-reveal */}
              <button
                type="button"
                onClick={() => update("freeze_auto_reveal", !form.freeze_auto_reveal)}
                className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                  form.freeze_auto_reveal
                    ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                    : "border-emerald-900/50 bg-[#042713] text-emerald-200/60"
                }`}
              >
                <div className="font-semibold">Auto-reveal when all finish</div>
                <div className="text-[10px] text-emerald-200/50 mt-0.5">Automatically unfreeze once every player submits</div>
              </button>

              {/* Reveal style — 2×2 grid */}
              <div className="space-y-2">
                <label className="text-[10px] text-emerald-200/55">Reveal style</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {REVEAL_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => update("reveal_style", m.value)}
                      className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        form.reveal_style === m.value
                          ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                          : "border-emerald-900/50 bg-[#042713] text-emerald-200/60"
                      }`}
                    >
                      <div className="text-xs font-semibold">{m.label}</div>
                      <div className="text-[10px] text-emerald-200/45 mt-0.5 leading-tight">{m.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Live preview */}
                {form.reveal_style !== "none" && (
                  <RevealModePreview mode={form.reveal_style} />
                )}
              </div>

              {/* Reveal top X */}
              {form.reveal_style !== "none" && (
                <div className="space-y-1.5">
                  <label className="text-[10px] text-emerald-200/55">Animate top ___ positions (leave blank for full field)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.reveal_top_x}
                    onChange={(e) => update("reveal_top_x", e.target.value)}
                    placeholder="e.g. 10 — blank = entire field"
                    className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EntryWindowSection({
  start, end, onChangeStart, onChangeEnd,
}: { start: string; end: string; onChangeStart: (v: string) => void; onChangeEnd: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const hasValue = !!(start || end);
  return (
    <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] uppercase tracking-wider text-emerald-200/65">Entry Window</span>
        <span className="text-[10px] text-emerald-100/50">{hasValue ? "Set" : "Optional"} {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] text-emerald-200/55">Opens</label>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => onChangeStart(e.target.value)}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-emerald-200/55">Closes</label>
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => onChangeEnd(e.target.value)}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function RulesTextSection({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-[11px] uppercase tracking-wider text-emerald-200/65">Rules Text</span>
        <span className="text-[10px] text-emerald-100/50">{value ? "Set" : "Optional"} {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            placeholder="Any specific rules or conditions for this event…"
            className="w-full rounded-xl border border-emerald-900/60 bg-[#042713] px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
          />
        </div>
      )}
    </div>
  );
}

export default function CreateEventClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedGroupId = searchParams.get("group_id") ?? "";

  const preselectedCompetitionId = searchParams.get("competition_id") ?? "";
  const preselectedEventTemplateId = searchParams.get("competition_event_template_id") ?? "";

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    ...INITIAL,
    group_id: preselectedGroupId,
    competition_id: preselectedCompetitionId,
    competition_event_template_id: preselectedEventTemplateId,
  });
  const [templateCompetition, setTemplateCompetition] = useState<Competition | null>(null);
  const [competitionEventTemplates, setCompetitionEventTemplates] = useState<CompetitionEventTemplate[]>([]);
  const [myGroups, setMyGroups] = useState<MajorGroup[]>([]);
  const [groupCompetitions, setGroupCompetitions] = useState<Competition[]>([]);
  const [groupDefaultsApplied, setGroupDefaultsApplied] = useState(false);
  const [showNewCompetitionModal, setShowNewCompetitionModal] = useState(false);
  const [newCompetitionName, setNewCompetitionName] = useState("");
  const [creatingCompetition, setCreatingCompetition] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupSeasons, setGroupSeasons] = useState<{ id: string; name: string; start_date: string; end_date: string }[]>([]);
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [teeBoxes, setTeeBoxes] = useState<{ id: string; name: string; gender: string | null }[]>([]);

  const isAggregate = form.event_category === "aggregate";
  const totalSteps = 4;

  useEffect(() => {
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/majors/groups?mode=mine", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        const groups: MajorGroup[] = (j.groups ?? []).filter((g: any) =>
          g.role === "owner" || g.role === "admin"
        );
        setMyGroups(groups);
        // Auto-apply defaults from pre-selected group
        if (preselectedGroupId) {
          const preGroup = groups.find((g) => g.id === preselectedGroupId);
          if (preGroup) {
            setForm((prev) => ({ ...prev, ...applyGroupDefaults(preGroup, prev) }));
            setGroupDefaultsApplied(true);
          }
        }
      }
    })();
  }, []);

  // Helper: apply group defaults to form (series/template settings take priority if set after)
  const applyGroupDefaults = (group: MajorGroup, prevForm: FormState): Partial<FormState> => {
    const prefs = group.default_scoring_prefs ?? {};
    const updates: Partial<FormState> = {};
    if (prefs.competition_type) {
      updates.event_type = prefs.competition_type;
      // Always couple scoring_model with type — use explicit prefs value if present, otherwise derive
      updates.scoring_model = prefs.scoring_model ?? FORMAT_DEFAULT_SCORING[prefs.competition_type] ?? prevForm.scoring_model;
    } else if (prefs.scoring_model) {
      updates.scoring_model = prefs.scoring_model;
    }
    if (prefs.points_model) updates.points_model = prefs.points_model;
    if (prefs.standings_contribution) updates.standings_contribution = prefs.standings_contribution;
    if (prefs.handicap_rules) {
      updates.handicap_mode = (prefs.handicap_rules.mode as PlayingHandicapMode) ?? prevForm.handicap_mode;
      updates.handicap_allowance_pct = prefs.handicap_rules.allowance_pct != null
        ? String(prefs.handicap_rules.allowance_pct)
        : prevForm.handicap_allowance_pct;
      updates.handicap_max = prefs.handicap_rules.max_handicap != null
        ? String(prefs.handicap_rules.max_handicap)
        : prevForm.handicap_max;
    }
    return updates;
  };

  // Helper: apply competition + optional event template settings to form
  const applyCompetitionSettings = (
    s: Competition,
    et: CompetitionEventTemplate | null,
    prevForm: FormState
  ): Partial<FormState> => {
    const baseSettings = (s.template_settings ?? {}) as Record<string, unknown>;
    const etSettings = (et?.template_settings ?? {}) as Record<string, unknown>;
    const mergedSettings = { ...baseSettings, ...etSettings };

    const appliedType = (et?.template_event_type ?? s.template_event_type) ?? prevForm.event_type;
    // Use explicit template scoring_model if provided; otherwise derive from type when type changed
    const explicitModel = et?.template_scoring_model ?? s.template_scoring_model;
    const appliedModel = explicitModel
      ?? (appliedType !== prevForm.event_type ? FORMAT_DEFAULT_SCORING[appliedType] : prevForm.scoring_model);

    return {
      event_category: s.template_event_category ?? prevForm.event_category,
      event_type: appliedType,
      scoring_model: appliedModel,
      points_model: (et?.template_points_model ?? s.template_points_model) ?? prevForm.points_model,
      rules_text: (et?.template_rules_text ?? s.template_rules_text) ?? prevForm.rules_text,
      handicap_mode: (mergedSettings.handicap_mode as PlayingHandicapMode | undefined) ?? prevForm.handicap_mode,
      handicap_allowance_pct: mergedSettings.handicap_allowance_pct != null
        ? String(mergedSettings.handicap_allowance_pct)
        : prevForm.handicap_allowance_pct,
      handicap_max: mergedSettings.max_handicap != null
        ? String(mergedSettings.max_handicap)
        : prevForm.handicap_max,
    };
  };

  // If launched from a competition template, fetch and pre-populate
  useEffect(() => {
    if (!preselectedCompetitionId) return;
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${preselectedCompetitionId}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) return;
      const j = await res.json();
      const s = j.competition as Competition & { event_templates?: CompetitionEventTemplate[] };
      if (!s) return;
      setTemplateCompetition(s);
      const templates = (s.event_templates ?? []).sort((a, b) => a.sort_order - b.sort_order);
      setCompetitionEventTemplates(templates);

      // Find event template if pre-selected
      const et = templates.find((t) => t.id === preselectedEventTemplateId) ?? null;
      setForm((prev) => ({
        ...prev,
        competition_event_template_id: et?.id ?? prev.competition_event_template_id,
        ...applyCompetitionSettings(s, et, prev),
      }));
    })();
  }, [preselectedCompetitionId]);

  // When user manually selects a different competition from the dropdown
  const handleCompetitionSelect = async (competitionId: string) => {
    update("competition_id", competitionId);
    update("competition_event_template_id", "");
    setCompetitionEventTemplates([]);
    if (!competitionId) return;
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/competitions/${competitionId}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) return;
    const j = await res.json();
    const s = j.competition as Competition & { event_templates?: CompetitionEventTemplate[] };
    if (!s) return;
    setTemplateCompetition(s);
    const templates = (s.event_templates ?? []).sort((a, b) => a.sort_order - b.sort_order);
    setCompetitionEventTemplates(templates);
    setForm((prev) => ({ ...prev, ...applyCompetitionSettings(s, null, prev) }));
  };

  // When user selects an event template from the dropdown
  const handleEventTemplateSelect = (etId: string) => {
    update("competition_event_template_id", etId);
    if (!templateCompetition) return;
    const et = competitionEventTemplates.find((t) => t.id === etId) ?? null;
    setForm((prev) => ({
      ...prev,
      competition_event_template_id: etId,
      ...applyCompetitionSettings(templateCompetition, et, prev),
    }));
  };

  // Load competitions whenever group selection changes
  useEffect(() => {
    if (!form.group_id) { setGroupCompetitions([]); return; }
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions?group_id=${form.group_id}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setGroupCompetitions(j.competitions ?? []);
      }
    })();
  }, [form.group_id]);

  // Load group seasons whenever group changes
  useEffect(() => {
    if (!form.group_id) { setGroupSeasons([]); return; }
    (async () => {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/groups/${form.group_id}/seasons`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setGroupSeasons(j.seasons ?? []);
      }
    })();
  }, [form.group_id]);

  useEffect(() => {
    if (!form.course_id) { setTeeBoxes([]); return; }
    fetch(`/api/courses/tee-boxes?course_id=${form.course_id}`)
      .then((r) => r.json())
      .then((j) => setTeeBoxes(j.tee_boxes ?? []));
  }, [form.course_id]);

  const update = (field: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleTypeChange = (type: EventTypeV2) => {
    setForm((prev) => ({
      ...prev,
      event_type: type,
      scoring_model: FORMAT_DEFAULT_SCORING[type] ?? "net",
    }));
  };

  const canNext = (): boolean => {
    if (step === 0) return form.name.trim().length > 0;
    return true;
  };

  const handleCreateCompetition = async () => {
    if (!newCompetitionName.trim() || !form.group_id) return;
    setCreatingCompetition(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/majors/competitions", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: form.group_id,
          name: newCompetitionName.trim(),
          template_event_category: form.event_category,
          template_event_type: form.event_type,
          template_scoring_model: form.scoring_model,
          template_points_model: form.points_model,
        }),
      });
      const j = await res.json();
      if (res.ok && j.competition) {
        setGroupCompetitions((prev) => [...prev, j.competition]);
        update("competition_id", j.competition.id);
        setShowNewCompetitionModal(false);
        setNewCompetitionName("");
      }
    } finally {
      setCreatingCompetition(false);
    }
  };

  const handleCoursePickerSelect = (courseId: string, courseName?: string) => {
    setForm((prev) => ({ ...prev, course_id: courseId, course_name: courseName ?? "" }));
    setShowCoursePicker(false);
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

      const res = await fetch("/api/majors/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description || null,
          group_id: form.group_id || null,
          event_category: form.event_category,
          event_type: isAggregate ? "custom" : form.event_type,
          format: form.format || null,
          course_id: form.course_id || null,
          default_tee_male_id: form.default_tee_male_id || null,
          default_tee_female_id: form.default_tee_female_id || null,
          event_date: form.event_date || null,
          entry_window_start: form.entry_window_start || null,
          entry_window_end: form.entry_window_end || null,
          rules_text: form.rules_text || null,
          scoring_model: form.scoring_model,
          points_model: form.points_model,
          points_table: form.points_model !== "none" ? form.points_table : {},
          num_rounds: isAggregate ? 0 : (parseInt(form.num_rounds, 10) || 1),
          standings_contribution: form.standings_contribution,
          competition_id: form.competition_id || null,
          competition_event_template_id: form.competition_event_template_id || null,
          event_year: form.competition_id && form.event_date
            ? new Date(form.event_date).getFullYear()
            : null,
          aggregate_config,
          handicap_rules: form.scoring_model !== "gross"
            ? {
                mode: form.handicap_mode,
                allowance_pct: (form.handicap_mode === "allowance_pct" || form.handicap_mode === "compare_against_lowest")
                  ? (parseInt(form.handicap_allowance_pct, 10) || 100)
                  : null,
                max_handicap: form.handicap_max ? parseInt(form.handicap_max, 10) : null,
              }
            : {},
          // Leaderboard freeze / ceremony reveal
          ...(form.freeze_enabled && !isAggregate ? {
            leaderboard_freeze_last_holes: form.freeze_last_holes ? parseInt(form.freeze_last_holes, 10) : null,
            leaderboard_freeze_scope: form.freeze_scope,
            leaderboard_freeze_top_x: form.freeze_scope === "top_x" && form.freeze_top_x
              ? parseInt(form.freeze_top_x, 10) : null,
            leaderboard_freeze_auto_reveal: form.freeze_auto_reveal,
            leaderboard_reveal_style: form.reveal_style,
            leaderboard_reveal_top_x: form.reveal_style !== "none" && form.reveal_top_x
              ? parseInt(form.reveal_top_x, 10) : null,
          } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create event"); return; }
      router.push(`/majors/events/${json.event.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    /* ── Step 0: Essentials ── */
    <div key="step0" className="space-y-5">
      {/* Name */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Event Name *</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="e.g. Spring Major 2026"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
        />
      </div>

      {/* Group */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Group (optional)</label>
        {myGroups.length > 0 ? (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => { update("group_id", ""); update("competition_id", ""); setGroupDefaultsApplied(false); }}
              className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                form.group_id === ""
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              Standalone (no group)
            </button>
            {myGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  setForm((prev) => ({ ...prev, group_id: g.id, ...applyGroupDefaults(g, prev) }));
                  setGroupDefaultsApplied(true);
                }}
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
            No groups yet.{" "}
            <button type="button" onClick={() => router.push("/majors/groups/create")} className="underline text-emerald-300">
              Create one?
            </button>
          </div>
        )}
      </div>

      {groupDefaultsApplied && (
        <div className="rounded-xl border border-emerald-700/50 bg-emerald-900/20 px-4 py-2 text-[11px] text-emerald-200/70">
          ✓ Defaults applied from group — review & adjust on the next steps
        </div>
      )}

      {/* Category */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Category</label>
        <div className="space-y-1.5">
          {EVENT_CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => update("event_category", c.value)}
              className={`w-full rounded-xl border px-4 py-2 text-left transition-colors ${
                form.event_category === c.value
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

      {/* Format + Scoring (inline chips, only for non-aggregate) */}
      {!isAggregate && (
        <>
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Format</label>
            <div className="grid grid-cols-2 gap-1.5">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTypeChange(t.value)}
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                    form.event_type === t.value
                      ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                      : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Scoring</label>
            {FORMAT_ALLOWS_SCORING_CHOICE(form.event_type) ? (
              <div className="flex gap-1.5">
                {SCORING_MODELS.filter((s) => s.value === "net" || s.value === "gross").map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => update("scoring_model", s.value)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm transition-colors ${
                      form.scoring_model === s.value
                        ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                        : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
                    }`}
                  >
                    {s.shortLabel}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-3 py-2 text-sm text-emerald-200/55">
                {form.scoring_model === "stableford_points" ? "Stableford Points" : "Match Result"} — determined by format
              </div>
            )}
          </div>
        </>
      )}

      {/* Date + Course */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Date</label>
        <input
          type="date"
          value={form.event_date}
          onChange={(e) => update("event_date", e.target.value)}
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
        />
        {(() => {
          if (!form.group_id || !form.event_date) return null;
          const matched = groupSeasons.find(
            (s) => s.start_date <= form.event_date && s.end_date >= form.event_date
          );
          if (matched) {
            return (
              <div className="text-[11px] text-emerald-400/80">
                Season: <span className="font-medium text-emerald-300">{matched.name}</span>
              </div>
            );
          }
          return (
            <div className="text-[11px] text-amber-400/80">
              No season covers this date.{" "}
              <button
                type="button"
                className="underline hover:text-amber-300"
                onClick={() => router.push(`/majors/groups/${form.group_id}?tab=settings`)}
              >
                Add a season →
              </button>
            </div>
          );
        })()}
      </div>
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Course (optional)</label>
        {form.course_id ? (
          <div className="flex items-center justify-between rounded-xl border border-emerald-600/60 bg-emerald-900/30 px-4 py-2.5">
            <span className="text-sm text-emerald-50 truncate">{form.course_name}</span>
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, course_id: "", course_name: "", default_tee_male_id: "", default_tee_female_id: "" }))}
              className="ml-3 text-[11px] text-emerald-300/60 hover:text-emerald-200 shrink-0"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCoursePicker(true)}
            className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-100/40 hover:border-emerald-700/60 text-left"
          >
            Search for a course…
          </button>
        )}
      </div>

      {/* Default tee boxes — shown once a course is selected */}
      {form.course_id && teeBoxes.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              label: "Men's default tee",
              field: "default_tee_male_id" as const,
              options: teeBoxes.filter((t) => !t.gender || t.gender === "male" || t.gender === "unisex"),
            },
            {
              label: "Women's default tee",
              field: "default_tee_female_id" as const,
              options: teeBoxes.filter((t) => !t.gender || t.gender === "female" || t.gender === "unisex"),
            },
          ].map(({ label, field, options }) => (
            <div key={field} className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/65">{label}</label>
              <select
                value={form[field]}
                onChange={(e) => update(field, e.target.value)}
                className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-[11px] text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
              >
                <option value="">— optional —</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>,

    /* ── Step 1: Handicap & Entry ── */
    <div key="step1" className="space-y-5">
      {groupDefaultsApplied && (
        <div className="rounded-xl border border-emerald-700/50 bg-emerald-900/20 px-4 py-2 text-[11px] text-emerald-200/70">
          ✓ Handicap rules pre-filled from group defaults
        </div>
      )}

      {/* Handicap rules */}
      {form.scoring_model !== "gross" && (
        <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/55 font-semibold">Handicap Rules</div>
          <HandicapRulesEditor
            value={{ mode: form.handicap_mode as any, allowance_pct: form.handicap_allowance_pct, max_handicap: form.handicap_max }}
            onChange={(v) => setForm((f) => ({ ...f, handicap_mode: v.mode as PlayingHandicapMode, handicap_allowance_pct: v.allowance_pct, handicap_max: v.max_handicap }))}
          />
        </div>
      )}

      {/* Entry window (collapsible) */}
      <EntryWindowSection
        start={form.entry_window_start}
        end={form.entry_window_end}
        onChangeStart={(v) => update("entry_window_start", v)}
        onChangeEnd={(v) => update("entry_window_end", v)}
      />

      {/* Rules text (expandable) */}
      <RulesTextSection value={form.rules_text} onChange={(v) => update("rules_text", v)} />
    </div>,

    /* ── Step 2: Structure ── */
    <div key="step2" className="space-y-5">
      {!isAggregate ? (
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
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Aggregate Source</label>
            <div className="space-y-1.5">
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
      )}

      {/* Points model */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Points Model</label>
        <div className="grid grid-cols-2 gap-1.5">
          {POINTS_MODELS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => update("points_model", p.value)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                form.points_model === p.value
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              <div className="text-sm font-semibold">{p.shortLabel}</div>
              {p.desc && <div className="text-[10px] text-emerald-200/50 mt-0.5">{p.desc}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Points table — visible when a points model is active */}
      <PointsTableEditor
        pointsModel={form.points_model}
        pointsTable={form.points_table}
        onChange={(table) => update("points_table", table as any)}
      />

      {/* Standings */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Season Standings</label>
        <div className="flex gap-1.5">
          {(["event_only", "season", "both"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => update("standings_contribution", v)}
              className={`flex-1 rounded-xl border px-2 py-2 text-[11px] text-center transition-colors ${
                form.standings_contribution === v
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              {v === "event_only" && "Event only"}
              {v === "season" && "Season"}
              {v === "both" && "Both"}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-emerald-200/45 leading-relaxed">
          {form.standings_contribution === "event_only" && "Result stays on this event's leaderboard only — won't affect season standings."}
          {form.standings_contribution === "season" && "Feeds into the group's cumulative season standings — no event leaderboard points."}
          {form.standings_contribution === "both" && "Counted in both this event's result and the group's season standings."}
        </p>
      </div>

      {/* Competition — only if group selected */}
      {form.group_id && (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Competition (optional)</label>
          <button
            type="button"
            onClick={() => { update("competition_id", ""); update("competition_event_template_id", ""); setCompetitionEventTemplates([]); setTemplateCompetition(null); }}
            className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
              form.competition_id === ""
                ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
            }`}
          >
            Not part of a competition
          </button>
          {groupCompetitions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => handleCompetitionSelect(s.id)}
              className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                form.competition_id === s.id
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              {s.name}
            </button>
          ))}
          <button type="button" onClick={() => setShowNewCompetitionModal(true)} className="text-[11px] text-emerald-400 underline">
            + Create new competition
          </button>
        </div>
      )}

      {/* Event template + Year */}
      {form.competition_id && competitionEventTemplates.length > 0 && (
        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Event (optional)</label>
          <button
            type="button"
            onClick={() => handleEventTemplateSelect("")}
            className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
              form.competition_event_template_id === ""
                ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
            }`}
          >
            Not linked to a specific event
          </button>
          {competitionEventTemplates.map((et) => (
            <button
              key={et.id}
              type="button"
              onClick={() => handleEventTemplateSelect(et.id)}
              className={`w-full text-left rounded-xl border px-4 py-2 text-sm transition-colors ${
                form.competition_event_template_id === et.id
                  ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                  : "border-emerald-900/50 bg-[#0b3b21]/40 text-emerald-200/60"
              }`}
            >
              <div>{et.name}</div>
              {et.typical_month != null && (
                <div className="text-[10px] text-emerald-200/45 mt-0.5">
                  Usually {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][et.typical_month - 1]}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Ceremony freeze (collapsible) */}
      {!isAggregate && (
        <LeaderboardFreezeSection form={form} update={update} />
      )}

      {/* Description (optional, at the bottom) */}
      <div className="space-y-2">
        <label className="text-[11px] uppercase tracking-wider text-emerald-200/65">Description (optional)</label>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={2}
          placeholder="Describe this event…"
          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
        />
      </div>
    </div>,

    /* ── Step 3: Review ── */
    <div key="step3" className="space-y-4">
      <div className="text-sm font-semibold text-emerald-50">Review & Create</div>
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-2">
        {[
          { label: "Name", value: form.name },
          { label: "Category", value: form.event_category },
          !isAggregate ? { label: "Format", value: form.event_type } : null,
          !isAggregate ? { label: "Scoring", value: form.scoring_model } : null,
          form.scoring_model !== "gross" && !isAggregate ? {
            label: "Handicap",
            value: form.handicap_mode === "compare_against_lowest"
              ? `Off the Lowest (${form.handicap_allowance_pct || 100}%)${form.handicap_max ? ` (max ${form.handicap_max})` : ""}`
              : form.handicap_mode === "none"
              ? "No Handicap"
              : form.handicap_mode === "fixed"
              ? `Fixed${form.handicap_max ? ` (max ${form.handicap_max})` : ""}`
              : `${form.handicap_allowance_pct || 100}%${form.handicap_max ? ` (max ${form.handicap_max})` : ""}`,
          } : null,
          { label: "Points", value: form.points_model },
          !isAggregate ? { label: "Rounds", value: form.num_rounds } : null,
          isAggregate ? { label: "Aggregate source", value: form.aggregate_source } : null,
          isAggregate && form.aggregate_top_n ? { label: "Top N events", value: form.aggregate_top_n } : null,
          { label: "Standings", value: form.standings_contribution === "event_only" ? "Event only" : form.standings_contribution === "season" ? "Season" : "Both" },
          form.group_id ? { label: "Group", value: myGroups.find((g) => g.id === form.group_id)?.name ?? form.group_id } : null,
          form.competition_id ? { label: "Competition", value: groupCompetitions.find((s) => s.id === form.competition_id)?.name ?? form.competition_id } : null,
          form.course_name ? { label: "Course", value: form.course_name } : null,
          form.event_date ? { label: "Date", value: form.event_date } : null,
          !isAggregate && form.freeze_enabled && form.freeze_last_holes
            ? { label: "Freeze", value: `Last ${form.freeze_last_holes} holes hidden${form.freeze_scope === "top_x" && form.freeze_top_x ? ` (top ${form.freeze_top_x})` : ""}` }
            : null,
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
    <div className="h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => (step === 0 ? router.back() : setStep((s) => s - 1))}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← {step === 0 ? "Back" : "Previous"}
        </button>
        <h1 className="text-base font-semibold text-[#f5e6b0]">Create Event</h1>
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
      {templateCompetition && (
        <div className="mb-5 rounded-xl border border-emerald-700/50 bg-emerald-900/30 px-4 py-2.5 flex items-center gap-2">
          <span className="text-[10px] text-emerald-400 shrink-0">Template</span>
          <span className="text-[11px] font-semibold text-emerald-50 truncate">{templateCompetition.name}</span>
          {form.event_date && <span className="text-[10px] text-emerald-200/50 shrink-0">· {new Date(form.event_date).getFullYear()}</span>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="pb-4"
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
            {submitting ? "Creating…" : "Create Event"}
          </button>
        )}
      </div>

      {/* Course picker modal */}
      <CoursePickerModal
        open={showCoursePicker}
        onClose={() => setShowCoursePicker(false)}
        onSelect={handleCoursePickerSelect}
      />

      {/* New competition modal */}
      {showNewCompetitionModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="w-full max-w-sm bg-[#0c2e18] rounded-t-2xl p-6 space-y-4">
            <div className="text-sm font-semibold text-emerald-50">New Competition</div>
            <input
              type="text"
              value={newCompetitionName}
              onChange={(e) => setNewCompetitionName(e.target.value)}
              placeholder="e.g. The Club Masters"
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-3 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setShowNewCompetitionModal(false); setNewCompetitionName(""); }}
                className="flex-1 py-2.5 rounded-full border border-emerald-800 text-sm text-emerald-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCompetition}
                disabled={!newCompetitionName.trim() || creatingCompetition}
                className="flex-1 py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-40"
              >
                {creatingCompetition ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LeaderboardEntryWithProfile, FrozenLeaderboardEntry, LeaderboardRevealStyle } from "@/lib/majors/types";

type Row = LeaderboardEntryWithProfile | FrozenLeaderboardEntry;

type Props = {
  rows: Row[];
  revealStyle: LeaderboardRevealStyle;
  revealTopX: number | null;
  scoringModel?: string;
  onDone: () => void;
};

const TIMING: Record<Exclude<LeaderboardRevealStyle, "podium">, { countdown: number; interval: number }> = {
  none:     { countdown: 0,    interval: 0 },
  animated: { countdown: 3000, interval: 1500 },
  suspense: { countdown: 5000, interval: 2500 },
  rapid:    { countdown: 1500, interval: 400 },
};

const SUSPENSE_COUNTDOWN_LABELS = ["Get ready…", "Almost there…", "Here we go…", "Here we go…"];

// Each row card is py-3 (24px) + content (~36px) + space-y-2 gap = ~68px
const ROW_HEIGHT_WITH_GAP = 68;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getProfile(row: Row) {
  return (row as any).profile as { id: string; name: string | null; avatar_url: string | null } | undefined;
}

function getScore(row: Row): number | null {
  return (row as any).net_score ?? (row as any).gross_score ?? null;
}

function getPodiumScore(row: Row, scoringModel?: string): string {
  if (scoringModel === "stableford_points") {
    const pts = (row as any).format_points ?? (row as any).net_score ?? (row as any).gross_score;
    return pts != null ? `${pts} pts` : "—";
  }
  const toPar = (row as any).to_par;
  if (toPar != null) {
    if (toPar === 0) return "E";
    return toPar > 0 ? `+${toPar}` : `${toPar}`;
  }
  const score = (row as any).net_score ?? (row as any).gross_score;
  return score != null ? String(score) : "—";
}

// ─── Shared sub-components ──────────────────────────────────────────────────

function AvatarCircle({
  profile,
  size = "md",
}: {
  profile: ReturnType<typeof getProfile>;
  size?: "sm" | "md" | "lg";
}) {
  const cls = size === "sm" ? "h-8 w-8 text-[9px]" : size === "lg" ? "h-16 w-16 text-sm" : "h-10 w-10 text-[10px]";
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" className={`${cls} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${cls} rounded-full bg-emerald-900/60 grid place-items-center font-bold text-emerald-200 shrink-0`}>
      {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
    </div>
  );
}

function RevealRow({ row, springProps }: { row: Row; springProps: object }) {
  const profile = getProfile(row);
  const score = getScore(row);
  const pos = row.position ?? 0;
  const isWinner = pos === 1;
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={springProps}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        isWinner
          ? "border-[#f5e6b0]/60 bg-[#f5e6b0]/10 shadow-lg shadow-[#f5e6b0]/10"
          : "border-emerald-900/50 bg-[#0b3b21]/70"
      }`}
    >
      <span className={`w-7 text-center font-extrabold ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]/70"}`}>
        {isWinner ? "🏆" : pos}
      </span>
      <AvatarCircle profile={profile} size="md" />
      <span className={`flex-1 font-semibold truncate ${isWinner ? "text-[#f5e6b0] text-base" : "text-sm text-emerald-50"}`}>
        {profile?.name ?? "Unknown"}
      </span>
      <span className={`font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]"}`}>
        {score ?? "—"}
      </span>
    </motion.div>
  );
}

function SuspenseCard({ row, delay }: { row: Row; delay: number }) {
  const [revealed, setRevealed] = useState(false);
  const profile = getProfile(row);
  const score = getScore(row);
  const pos = row.position ?? 0;
  const isWinner = pos === 1;

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), delay + 1000);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        isWinner && revealed
          ? "border-[#f5e6b0]/60 bg-[#f5e6b0]/10 shadow-lg shadow-[#f5e6b0]/10"
          : "border-emerald-900/50 bg-[#0b3b21]/70"
      }`}
    >
      <span className={`w-7 text-center font-extrabold ${isWinner && revealed ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]/70"}`}>
        {isWinner && revealed ? "🏆" : pos}
      </span>
      <AnimatePresence mode="wait">
        {!revealed ? (
          <motion.div key="hidden" initial={{ rotateY: 0 }} exit={{ rotateY: 90 }} transition={{ duration: 0.25 }} className="flex flex-1 items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200/40 shrink-0">?</div>
            <span className="flex-1 font-semibold text-sm text-emerald-200/40 tracking-widest">— — —</span>
            <span className="font-extrabold text-xs text-[#f5e6b0]/30 shrink-0">??</span>
          </motion.div>
        ) : (
          <motion.div key="revealed" initial={{ rotateY: -90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.35, type: "spring", stiffness: 300, damping: 24 }} className="flex flex-1 items-center gap-3">
            <AvatarCircle profile={profile} size="md" />
            <span className={`flex-1 font-semibold truncate ${isWinner ? "text-[#f5e6b0] text-base" : "text-sm text-emerald-50"}`}>{profile?.name ?? "Unknown"}</span>
            <span className={`font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]"}`}>{score ?? "—"}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ScrollRow({ row }: { row: Row }) {
  const profile = getProfile(row);
  const score = getScore(row);
  const pos = row.position ?? 0;
  const isWinner = pos === 1;
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
      isWinner ? "border-[#f5e6b0]/60 bg-[#f5e6b0]/10" : "border-emerald-900/50 bg-[#0b3b21]/70"
    }`}>
      <span className={`w-7 text-center font-extrabold ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]/70"}`}>
        {isWinner ? "🏆" : pos}
      </span>
      <AvatarCircle profile={profile} size="md" />
      <span className={`flex-1 font-semibold truncate ${isWinner ? "text-[#f5e6b0] text-base" : "text-sm text-emerald-50"}`}>
        {profile?.name ?? "Unknown"}
      </span>
      <span className={`font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]"}`}>
        {score ?? "—"}
      </span>
    </div>
  );
}

// ─── Score counter (used in PodiumSlot) ─────────────────────────────────────

function ScoreCounter({ score, textClass }: { score: string; textClass: string }) {
  const [displayed, setDisplayed] = useState(score === "—" ? score : "");
  const [settled, setSettled] = useState(score === "—");

  useEffect(() => {
    if (score === "—") { setDisplayed("—"); setSettled(true); return; }
    const isPoints = score.endsWith(" pts");
    const isToPar = score === "E" || /^[+-]\d+$/.test(score);
    function randomFake(): string {
      if (isPoints) {
        const base = parseInt(score, 10) || 36;
        return `${Math.max(1, base + Math.floor(Math.random() * 20) - 10)} pts`;
      }
      if (isToPar) {
        const n = Math.floor(Math.random() * 14) - 7;
        return n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;
      }
      return String(68 + Math.floor(Math.random() * 27));
    }
    const intervals = [60, 70, 80, 100, 130, 160];
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      if (step < intervals.length) {
        setDisplayed(randomFake());
        timer = setTimeout(tick, intervals[step++]);
      } else {
        setDisplayed(score);
        setSettled(true);
      }
    }
    timer = setTimeout(tick, intervals[step++]);
    return () => clearTimeout(timer);
  }, [score]);

  return (
    <motion.span
      className={`font-extrabold tabular-nums ${textClass}`}
      animate={settled ? { scale: [1, 1.4, 1] } : {}}
      transition={settled ? { duration: 0.35, ease: "easeOut" } : {}}
    >
      {displayed}
    </motion.span>
  );
}

// ─── Dramatic Podium ─────────────────────────────────────────────────────────

type PodiumPhase = "bubbles" | "tension" | "popping" | "celebrate";

const PODIUM_COLORS = {
  1: {
    border: "border-[#f5e6b0]/70",
    bg: "bg-[#f5e6b0]/15",
    text: "text-[#f5e6b0]",
    height: "140px",
    label: "1",
    gradient: "linear-gradient(180deg, #c9a227 0%, #9a7b1a 40%, #6b5112 100%)",
    ring: "ring-[#f5e6b0]",
  },
  2: {
    border: "border-slate-400/50",
    bg: "bg-slate-800/50",
    text: "text-slate-200",
    height: "100px",
    label: "2",
    gradient: "linear-gradient(180deg, #94a3b8 0%, #64748b 40%, #334155 100%)",
    ring: "ring-slate-300",
  },
  3: {
    border: "border-amber-700/50",
    bg: "bg-amber-900/30",
    text: "text-amber-300",
    height: "75px",
    label: "3",
    gradient: "linear-gradient(180deg, #b45309 0%, #92400e 40%, #5c2d0a 100%)",
    ring: "ring-amber-600",
  },
} as const;

function FloatingBubble({
  row,
  startX,
  startY,
  driftX,
  driftY,
  duration,
  isGrowing,
  isPopped,
  pulsePeak,
  pulseDelay,
  sizeClass,
}: {
  row: Row;
  startX: number;
  startY: number;
  driftX: number;
  driftY: number;
  duration: number;
  isGrowing: boolean;
  isPopped: boolean;
  pulsePeak: number;
  pulseDelay: number;
  sizeClass: string;
}) {
  const profile = getProfile(row);

  if (isPopped && !isGrowing) return null;

  return (
    <>
      <motion.div
        style={{ position: "absolute", left: startX, top: startY, originX: "50%", originY: "50%" }}
        animate={
          isGrowing
            ? { scale: [1, 4.0, 0], opacity: [1, 1, 0] }
            : {
                x: [0, driftX, 0, -driftX * 0.7, 0],
                y: [0, driftY * 0.6, driftY, driftY * 0.3, 0],
                scale: [1, pulsePeak, 0.88, pulsePeak * 0.9, 1],
              }
        }
        transition={
          isGrowing
            ? { duration: 0.9, times: [0, 0.6, 1], ease: "easeIn" }
            : { duration, repeat: Infinity, ease: "easeInOut", delay: pulseDelay }
        }
        className={`${sizeClass} rounded-full border-2 border-emerald-700/50 bg-emerald-900/60 grid place-items-center overflow-hidden shadow-lg`}
      >
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[11px] font-bold text-emerald-200">
            {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
          </span>
        )}
      </motion.div>

      {isGrowing && (
        <motion.div
          style={{
            position: "absolute",
            left: startX,
            top: startY,
            originX: "50%",
            originY: "50%",
            pointerEvents: "none",
          }}
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 6, opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className={`${sizeClass} rounded-full border-2 border-emerald-400/60`}
        />
      )}
    </>
  );
}

function PodiumSlot({
  position,
  row,
  isRevealed,
  scoringModel,
}: {
  position: 1 | 2 | 3;
  row: Row | undefined;
  isRevealed: boolean;
  scoringModel?: string;
}) {
  const profile = row ? getProfile(row) : undefined;
  const score = row ? getPodiumScore(row, scoringModel) : "—";
  const colors = PODIUM_COLORS[position];

  return (
    <div className="flex flex-col items-center" style={{ width: "30%" }}>
      {/* Avatar overlaps the top edge of the podium */}
      <div className="relative z-10 mb-[-28px]">
        <AnimatePresence>
          {isRevealed && row && (
            <motion.div
              initial={{ opacity: 0, y: -50, scale: 0.3 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              className={`ring-2 ${colors.ring} rounded-full shadow-xl`}
            >
              <AvatarCircle profile={profile} size="lg" />
            </motion.div>
          )}
        </AnimatePresence>
        {!isRevealed && <div className="h-16 w-16 opacity-0" />}
      </div>

      {/* Podium body */}
      <div
        className="w-full rounded-t-lg relative overflow-hidden flex flex-col items-center"
        style={{ background: colors.gradient, height: colors.height }}
      >
        {/* Shine overlay */}
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />

        {/* Name */}
        <AnimatePresence>
          {isRevealed && row && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className={`absolute inset-x-0 top-8 text-center text-[10px] font-bold leading-tight px-1 truncate ${colors.text}`}
            >
              {profile?.name ?? "Unknown"}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Score counter */}
        <AnimatePresence>
          {isRevealed && row && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
              className="absolute inset-x-0 top-[52px] flex justify-center"
            >
              <ScoreCounter score={score} textClass={`text-xs ${colors.text}`} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Large background position number */}
        <span
          className={`absolute bottom-1.5 inset-x-0 text-center text-4xl font-black ${colors.text} opacity-25 select-none`}
        >
          {colors.label}
        </span>
      </div>
    </div>
  );
}

function PodiumRevealInner({
  rows,
  scoringModel,
  replayKey,
  onComplete,
}: {
  rows: Row[];
  scoringModel?: string;
  replayKey: number;
  onComplete: () => void;
}) {
  const [podiumPhase, setPodiumPhase] = useState<PodiumPhase>("bubbles");
  const [poppedPositions, setPoppedPositions] = useState<number[]>([]);
  const [growingPosition, setGrowingPosition] = useState<number | null>(null);
  const [tickerIdx, setTickerIdx] = useState(0);

  // Randomise 2nd/3rd reveal order once per mount/replay
  const revealOrder = useMemo(() => Math.random() < 0.5 ? [2, 3, 1] : [3, 2, 1], [replayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const podiumRows = useMemo(
    () => rows.filter((r) => (r.position ?? 99) <= 3),
    [rows]
  );
  const fieldRows = useMemo(
    () => rows.filter((r) => (r.position ?? 99) > 3),
    [rows]
  );

  // Seeded random bubble positions — stable per replayKey
  const bubbleData = useMemo(() => {
    const W = typeof window !== "undefined" ? window.innerWidth : 390;
    const H = typeof window !== "undefined" ? window.innerHeight : 700;
    const safeH = H * 0.55; // keep bubbles in top 55% (above podium)
    const SIZE_CLASSES = ["w-12 h-12", "w-14 h-14", "w-16 h-16", "w-20 h-20"] as const;
    return rows.map((_, i) => {
      const seed = i * 7.3 + replayKey * 13.1;
      const rand = (n: number) => Math.abs(Math.sin(seed + n) * 10000) % 1;
      return {
        startX: rand(1) * (W - 80) + 10,
        startY: rand(2) * (safeH - 80) + 10,
        driftX: (rand(3) - 0.5) * 60,
        driftY: (rand(4) - 0.5) * 40,
        duration: 3.5 + rand(5) * 2.5,
        pulsePeak: 1.15 + rand(6) * 0.45,
        pulseDelay: rand(7) * 2,
        sizeClass: SIZE_CLASSES[Math.floor(rand(8) * 4)],
      };
    });
  }, [rows.length, replayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset on replay
  useEffect(() => {
    setPodiumPhase("bubbles");
    setPoppedPositions([]);
    setGrowingPosition(null);
    setTickerIdx(0);
  }, [replayKey]);

  // Score ticker — cycles ALL rows rapidly to build tension
  useEffect(() => {
    if (podiumPhase !== "bubbles" || rows.length === 0) return;
    const t = setInterval(() => setTickerIdx((i) => (i + 1) % Math.max(1, rows.length)), 400);
    return () => clearInterval(t);
  }, [podiumPhase, rows.length]);

  // Bubbles → tension
  useEffect(() => {
    if (podiumPhase !== "bubbles") return;
    const t = setTimeout(() => setPodiumPhase("tension"), 5000);
    return () => clearTimeout(t);
  }, [podiumPhase, replayKey]);

  // Tension → popping
  useEffect(() => {
    if (podiumPhase !== "tension") return;
    const t = setTimeout(() => setPodiumPhase("popping"), 1800);
    return () => clearTimeout(t);
  }, [podiumPhase]);

  // Popping sequence
  useEffect(() => {
    if (podiumPhase !== "popping") return;
    const nextIdx = poppedPositions.length;
    if (nextIdx >= revealOrder.length) {
      setPodiumPhase("celebrate");
      return;
    }
    const pos = revealOrder[nextIdx];
    // 3rd/2nd gap: 700ms (quick succession); winner: 2000ms (dramatic pause)
    const delay = pos === 1 ? 2000 : nextIdx === 0 ? 0 : 700;

    const t = setTimeout(() => {
      setGrowingPosition(pos);
      // Pop the bubble halfway through the grow animation
      const popTimer = setTimeout(() => {
        setPoppedPositions((prev) => [...prev, pos]);
        setGrowingPosition(null);
      }, 520);
      return () => clearTimeout(popTimer);
    }, delay);
    return () => clearTimeout(t);
  }, [podiumPhase, poppedPositions.length, revealOrder]);

  // Celebrate → done
  useEffect(() => {
    if (podiumPhase !== "celebrate") return;
    const t = setTimeout(onComplete, 2500);
    return () => clearTimeout(t);
  }, [podiumPhase, onComplete]);

  const getRowForPosition = (pos: number) => podiumRows.find((r) => r.position === pos);
  const tickerRow = rows[tickerIdx % Math.max(1, rows.length)];

  return (
    <div className="relative w-full h-full overflow-hidden">

      {/* Score ticker */}
      <div className="absolute top-0 left-0 right-0 z-10 pt-5 flex justify-center">
        <AnimatePresence mode="wait">
          {podiumPhase === "bubbles" && tickerRow && (
            <motion.div
              key={tickerIdx}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.35 }}
              className="flex items-center gap-2 rounded-full border border-emerald-900/50 bg-[#0b3b21]/60 px-4 py-1.5 backdrop-blur-sm"
            >
              <span className="text-[11px] text-emerald-200/80">{getProfile(tickerRow)?.name ?? "—"}</span>
              <span className="text-[11px] font-bold text-[#f5e6b0]">{getPodiumScore(tickerRow, scoringModel)}</span>
            </motion.div>
          )}
          {(podiumPhase === "tension" || podiumPhase === "popping") && (
            <motion.p
              key="tension-label"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[#f5e6b0] text-lg font-bold tracking-widest uppercase"
            >
              {podiumPhase === "tension" ? "The results are in…" : "And the podium is…"}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Floating bubbles */}
      <div className="absolute inset-0" style={{ bottom: "38%" }}>
        {rows.map((row, i) => {
          const pos = row.position ?? 99;
          const isGrowing = growingPosition === pos;
          const isPopped = poppedPositions.includes(pos);
          const d = bubbleData[i];
          return (
            <FloatingBubble
              key={row.profile_id}
              row={row}
              startX={d.startX}
              startY={d.startY}
              driftX={d.driftX}
              driftY={d.driftY}
              duration={d.duration}
              isGrowing={isGrowing}
              isPopped={isPopped}
              pulsePeak={d.pulsePeak}
              pulseDelay={d.pulseDelay}
              sizeClass={d.sizeClass}
            />
          );
        })}
      </div>

      {/* Podium */}
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-1 px-4 pb-0">
        <PodiumSlot position={2} row={getRowForPosition(2)} isRevealed={poppedPositions.includes(2)} scoringModel={scoringModel} />
        <PodiumSlot position={1} row={getRowForPosition(1)} isRevealed={poppedPositions.includes(1)} scoringModel={scoringModel} />
        <PodiumSlot position={3} row={getRowForPosition(3)} isRevealed={poppedPositions.includes(3)} scoringModel={scoringModel} />
      </div>

      {/* 1st place celebration pulse */}
      <AnimatePresence>
        {podiumPhase === "celebrate" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.3, 0] }}
            transition={{ duration: 1.2, delay: 0.3 }}
            className="absolute inset-0 bg-[#f5e6b0] pointer-events-none"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LeaderboardReveal({ rows, revealStyle, revealTopX, scoringModel, onDone }: Props) {
  const [phase, setPhase] = useState<"podium_anim" | "countdown" | "reveal" | "scroll">(
    revealStyle === "podium" ? "podium_anim" : "countdown"
  );
  const [revealedCount, setRevealedCount] = useState(0);
  const [suspenseLabel, setSuspenseLabel] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const suspenseLabelRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rowsToReveal = revealTopX != null
    ? rows.filter((r) => (r.position ?? 99) <= revealTopX).sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
    : [...rows].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  const timing = revealStyle !== "podium" ? (TIMING[revealStyle] ?? TIMING.animated) : { countdown: 0, interval: 0 };
  const { countdown, interval } = timing;

  // Enough copies so the scroll never shows a gap for small fields
  const copies = Math.max(2, Math.ceil(1600 / Math.max(1, rowsToReveal.length * ROW_HEIGHT_WITH_GAP)));
  const scrollRows = useMemo(
    () => Array.from({ length: copies }, () => rowsToReveal).flat(),
    [rowsToReveal.length, copies] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const scrollHeight = rowsToReveal.length * ROW_HEIGHT_WITH_GAP;
  const scrollDuration = Math.max(rowsToReveal.length * 2.5, 8);

  function handleReplay() {
    setPhase(revealStyle === "podium" ? "podium_anim" : "countdown");
    setRevealedCount(0);
    setSuspenseLabel(0);
    setReplayKey((k) => k + 1);
  }

  // Countdown phase (non-podium modes)
  useEffect(() => {
    if (revealStyle === "none") { onDone(); return; }
    if (revealStyle === "podium") return;
    if (phase !== "countdown") return;

    if (revealStyle === "suspense") {
      suspenseLabelRef.current = setInterval(() => {
        setSuspenseLabel((l) => Math.min(l + 1, SUSPENSE_COUNTDOWN_LABELS.length - 1));
      }, 1500);
    }

    const t = setTimeout(() => {
      if (suspenseLabelRef.current) clearInterval(suspenseLabelRef.current);
      setPhase("reveal");
    }, countdown);

    return () => {
      clearTimeout(t);
      if (suspenseLabelRef.current) clearInterval(suspenseLabelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealStyle, countdown, onDone, replayKey, phase]);

  // Reveal tick (non-podium modes)
  useEffect(() => {
    if (phase !== "reveal") return;
    if (revealedCount >= rowsToReveal.length) { setPhase("scroll"); return; }
    const t = setTimeout(() => setRevealedCount((c) => c + 1), interval);
    return () => clearTimeout(t);
  }, [phase, revealedCount, rowsToReveal.length, interval]);

  const visibleRows = rowsToReveal.slice(0, revealedCount);

  const springProps = revealStyle === "rapid"
    ? { type: "spring" as const, stiffness: 400, damping: 28 }
    : { type: "spring" as const, stiffness: 260, damping: 22 };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#051a0d]/95 backdrop-blur-sm">

      {/* ── Podium animation phase ── */}
      {phase === "podium_anim" && (
        <PodiumRevealInner
          rows={rows}
          scoringModel={scoringModel}
          replayKey={replayKey}
          onComplete={() => setPhase("scroll")}
        />
      )}

      {/* ── Scroll phase (all modes share this) ── */}
      {phase === "scroll" && (
        <motion.div key="scroll" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full">
          {/* Top bar — z-10 so scrolling rows can't block clicks */}
          <div className="relative z-10 flex items-center justify-between px-4 pt-5 pb-3 shrink-0">
            <button type="button" onClick={handleReplay} className="text-xs text-emerald-200/40 hover:text-emerald-100 transition-colors">
              ↺ Replay
            </button>
            <p className="text-[#f5e6b0] text-sm font-semibold tracking-widest uppercase">
              {revealTopX != null ? `Top ${revealTopX}` : "Final Results"}
            </p>
            <button type="button" onClick={onDone} className="text-emerald-200/40 hover:text-emerald-100 transition-colors text-xl leading-none px-1">
              ×
            </button>
          </div>

          <div className="border-t border-emerald-900/40 mx-4 shrink-0" />

          <div className="flex-1 overflow-hidden relative mt-3 px-4">
            <motion.div
              animate={{ y: [0, -scrollHeight] }}
              transition={{ duration: scrollDuration, repeat: Infinity, ease: "linear" }}
              className="space-y-2 pointer-events-none"
            >
              {scrollRows.map((row, i) => (
                <ScrollRow key={`${row.profile_id}-${i}`} row={row} />
              ))}
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* ── Countdown + reveal phases ── */}
      {(phase === "countdown" || phase === "reveal") && (
        <div className="flex flex-col items-center justify-center flex-1">
          <AnimatePresence mode="wait">
            {phase === "countdown" && (
              <motion.div
                key={`countdown-${replayKey}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.2 }}
                className="text-center space-y-3"
              >
                {revealStyle === "suspense" ? (
                  <>
                    <AnimatePresence mode="wait">
                      <motion.p key={suspenseLabel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="text-[#f5e6b0] text-2xl font-bold tracking-widest uppercase">
                        {SUSPENSE_COUNTDOWN_LABELS[suspenseLabel]}
                      </motion.p>
                    </AnimatePresence>
                    <div className="flex justify-center gap-2">
                      {[0, 1, 2, 3].map((i) => (
                        <motion.div key={i} className="w-2 h-2 rounded-full bg-[#f5e6b0]" animate={{ opacity: [0.15, 1, 0.15], scale: [0.8, 1.2, 0.8] }} transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.45 }} />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[#f5e6b0] text-2xl font-bold tracking-widest uppercase">
                      {revealStyle === "rapid" ? "Stand by…" : "Results incoming"}
                    </p>
                    <div className="flex justify-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <motion.div key={i} className="w-2 h-2 rounded-full bg-emerald-400" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: revealStyle === "rapid" ? 0.6 : 1.2, repeat: Infinity, delay: i * 0.3 }} />
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {phase === "reveal" && (
              <motion.div key={`reveal-${replayKey}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-sm px-4 space-y-3">
                <p className="text-center text-[#f5e6b0] text-sm font-semibold tracking-widest uppercase mb-4">
                  {revealTopX != null ? `Top ${revealTopX} Results` : "Final Results"}
                </p>
                <div className="space-y-2">
                  <AnimatePresence>
                    {revealStyle === "suspense"
                      ? visibleRows.map((row, i) => <SuspenseCard key={row.profile_id} row={row} delay={i * interval} />)
                      : visibleRows.map((row) => <RevealRow key={row.profile_id} row={row} springProps={springProps} />)}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

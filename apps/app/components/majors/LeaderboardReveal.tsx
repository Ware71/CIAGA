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

const ROW_HEIGHT_WITH_GAP = 68;
const LEADING_SPACER_HEIGHT = 500;
const SECTION_SPACER_HEIGHT = ROW_HEIGHT_WITH_GAP * 3;

const BUBBLE_SIZE_CLASSES = ["w-12 h-12", "w-14 h-14", "w-16 h-16", "w-20 h-20"] as const;
const BUBBLE_SIZE_PX = [48, 56, 64, 80] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getProfile(row: Row) {
  return (row as any).profile as { id: string; name: string | null; avatar_url: string | null } | undefined;
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

function RevealRow({ row, springProps, scoringModel }: { row: Row; springProps: object; scoringModel?: string }) {
  const profile = getProfile(row);
  const score = getPodiumScore(row, scoringModel);
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
        {score}
      </span>
    </motion.div>
  );
}

function SuspenseCard({ row, delay, scoringModel }: { row: Row; delay: number; scoringModel?: string }) {
  const [revealed, setRevealed] = useState(false);
  const profile = getProfile(row);
  const score = getPodiumScore(row, scoringModel);
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
            <span className={`font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]"}`}>{score}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ScrollRow({ row, scoringModel }: { row: Row; scoringModel?: string }) {
  const profile = getProfile(row);
  const score = getPodiumScore(row, scoringModel);
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
        {score}
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

// ─── Fake ticker score ─────────────────────────────────────────────────────

function FakeTicker({ scoringModel }: { scoringModel?: string }) {
  const [val, setVal] = useState("??");
  useEffect(() => {
    const isPoints = scoringModel === "stableford_points";
    const rand = () => {
      if (isPoints) return `${Math.floor(Math.random() * 20) + 28} pts`;
      const n = Math.floor(Math.random() * 14) - 7;
      return n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;
    };
    const t = setInterval(() => setVal(rand()), 300);
    return () => clearInterval(t);
  }, [scoringModel]);
  return <span className="text-[11px] font-bold text-[#f5e6b0]">{val}</span>;
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
  sizePx,
  driftX,
  driftY,
  duration,
  targetDx,
  targetDy,
  isGrowing,
  isPopped,
  isAborting,
  pulsePeak,
  pulseDelay,
  sizeClass,
}: {
  row: Row;
  startX: number;
  startY: number;
  sizePx: number;
  driftX: number;
  driftY: number;
  duration: number;
  targetDx: number;
  targetDy: number;
  isGrowing: boolean;
  isPopped: boolean;
  isAborting: boolean;
  pulsePeak: number;
  pulseDelay: number;
  sizeClass: string;
}) {
  const profile = getProfile(row);

  if (isPopped && !isGrowing) return null;

  const left = startX - sizePx / 2;
  const top = startY - sizePx / 2;

  return (
    <>
      <motion.div
        style={{ position: "absolute", left, top, originX: "50%", originY: "50%" }}
        animate={
          isGrowing
            ? {
                scale: [1, 4.0, 0],
                opacity: [1, 1, 0],
                x: [0, targetDx * 0.4, targetDx * 0.8],
                y: [0, targetDy * 0.4, targetDy * 0.8],
              }
            : isAborting
            ? {
                scale: [1, 2.2, 1],
                opacity: [1, 1, 1],
                x: [0, targetDx * 0.45, 0],
                y: [0, targetDy * 0.45, 0],
              }
            : {
                x: [0, driftX, 0, -driftX * 0.7, 0],
                y: [0, driftY * 0.6, driftY, driftY * 0.3, 0],
                scale: [1, pulsePeak, 0.88, pulsePeak * 0.9, 1],
              }
        }
        transition={
          isGrowing
            ? { duration: 0.9, times: [0, 0.6, 1], ease: "easeIn" }
            : isAborting
            ? { duration: 2.5, times: [0, 0.5, 1], ease: [0.4, 0, 0.2, 1] as any }
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
            left,
            top,
            originX: "50%",
            originY: "50%",
            pointerEvents: "none",
          }}
          initial={{ scale: 1, opacity: 0.9, x: 0, y: 0 }}
          animate={{ scale: 6, opacity: 0, x: targetDx * 0.4, y: targetDy * 0.4 }}
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

      <div
        className="w-full rounded-t-lg relative overflow-hidden flex flex-col items-center"
        style={{ background: colors.gradient, height: colors.height }}
      >
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />

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
  const [abortBubble, setAbortBubble] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({
    w: typeof window !== "undefined" ? window.innerWidth : 390,
    h: typeof window !== "undefined" ? window.innerHeight : 700,
  });
  const [dimsMeasured, setDimsMeasured] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0) {
      setDims({ w: rect.width, h: rect.height });
    }
    setDimsMeasured(true);
  }, []);

  const revealOrder = useMemo(() => Math.random() < 0.5 ? [2, 3, 1] : [3, 2, 1], [replayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const podiumRows = useMemo(
    () => rows.filter((r) => (r.position ?? 99) <= 3),
    [rows]
  );

  const bubbleData = useMemo(() => {
    const W = dims.w;
    const H = dims.h;
    const safeH = H * 0.55;
    return rows.map((_, i) => {
      const seed = i * 7.3 + replayKey * 13.1;
      const rand = (n: number) => Math.abs(Math.sin(seed + n) * 10000) % 1;
      const sizeIdx = Math.floor(rand(8) * 4);
      const sizePx = BUBBLE_SIZE_PX[sizeIdx];
      const startX = rand(1) * (W - sizePx) + sizePx / 2;
      const startY = rand(2) * (safeH - sizePx) + sizePx / 2;
      return {
        startX,
        startY,
        sizePx,
        driftX: (rand(3) - 0.5) * 60,
        driftY: (rand(4) - 0.5) * 40,
        duration: 3.5 + rand(5) * 2.5,
        pulsePeak: 1.15 + rand(6) * 0.45,
        pulseDelay: rand(7) * 2,
        sizeClass: BUBBLE_SIZE_CLASSES[sizeIdx],
        targetDx: W / 2 - startX,
        targetDy: H - startY,
      };
    });
  }, [rows.length, replayKey, dims]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset on replay
  useEffect(() => {
    setPodiumPhase("bubbles");
    setPoppedPositions([]);
    setGrowingPosition(null);
    setTickerIdx(0);
    setAbortBubble(null);
  }, [replayKey]);

  // Score ticker
  useEffect(() => {
    if (podiumPhase !== "bubbles" || rows.length === 0) return;
    const t = setInterval(() => setTickerIdx((i) => (i + 1) % Math.max(1, rows.length)), 400);
    return () => clearInterval(t);
  }, [podiumPhase, rows.length]);

  // Abort events during bubbles phase (replace scare events)
  useEffect(() => {
    if (podiumPhase !== "bubbles") return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const pool = rows
      .map((r, i) => ({ i, pos: r.position ?? 99 }))
      .filter(({ pos }) => pos !== 1)
      .map(({ i }) => i);
    const abortPool = pool.length > 0 ? pool : rows.map((_, i) => i);
    if (abortPool.length === 0) return;

    const abort1 = abortPool[Math.floor(Math.random() * abortPool.length)];
    timers.push(
      setTimeout(() => {
        setAbortBubble(abort1);
        timers.push(setTimeout(() => setAbortBubble(null), 2500));
      }, 1800)
    );

    const abort2Pool = abortPool.filter((i) => i !== abort1);
    if (abort2Pool.length > 0) {
      const abort2 = abort2Pool[Math.floor(Math.random() * abort2Pool.length)];
      timers.push(
        setTimeout(() => {
          setAbortBubble(abort2);
          timers.push(setTimeout(() => setAbortBubble(null), 2500));
        }, 4200)
      );
    }

    return () => timers.forEach(clearTimeout);
  }, [podiumPhase, replayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abort event during the 2s window before 1st place is revealed
  useEffect(() => {
    if (podiumPhase !== "popping") return;
    const nextIdx = poppedPositions.length;
    if (nextIdx !== revealOrder.length - 1) return;
    if (revealOrder[nextIdx] !== 1) return;

    // Prefer a field row (position > 3); fall back to any non-winner un-popped row
    const fieldPool = rows
      .map((r, i) => ({ i, pos: r.position ?? 99 }))
      .filter(({ pos }) => pos > 3)
      .map(({ i }) => i);
    const fallbackPool = rows
      .map((r, i) => ({ i, pos: r.position ?? 99 }))
      .filter(({ pos }) => pos !== 1 && !poppedPositions.includes(pos))
      .map(({ i }) => i);
    const pool = fieldPool.length > 0 ? fieldPool : fallbackPool;
    if (pool.length === 0) return;

    const target = pool[Math.floor(Math.random() * pool.length)];
    const t = setTimeout(() => {
      setAbortBubble(target);
      setTimeout(() => setAbortBubble(null), 1800);
    }, 300);
    return () => clearTimeout(t);
  }, [podiumPhase, poppedPositions.length, revealOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bubbles → tension
  useEffect(() => {
    if (podiumPhase !== "bubbles") return;
    const t = setTimeout(() => setPodiumPhase("tension"), 7000);
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
    const delay = pos === 1 ? 2000 : nextIdx === 0 ? 0 : 1200;

    const t = setTimeout(() => {
      setGrowingPosition(pos);
      const popTimer = setTimeout(() => {
        setPoppedPositions((prev) => [...prev, pos]);
        setGrowingPosition(null);
      }, 520);
      return () => clearTimeout(popTimer);
    }, delay);
    return () => clearTimeout(t);
  }, [podiumPhase, poppedPositions.length, revealOrder]);

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
              <FakeTicker scoringModel={scoringModel} />
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

      {/* Floating bubbles — positioned in the upper 62% of the screen */}
      <div ref={containerRef} className="absolute inset-0" style={{ bottom: "38%" }}>
        {dimsMeasured && rows.map((row, i) => {
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
              sizePx={d.sizePx}
              driftX={d.driftX}
              driftY={d.driftY}
              duration={d.duration}
              targetDx={d.targetDx}
              targetDy={d.targetDy}
              isGrowing={isGrowing}
              isPopped={isPopped}
              isAborting={abortBubble === i}
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

      {/* Tap to continue — appears after celebrate flash settles */}
      <AnimatePresence>
        {podiumPhase === "celebrate" && (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 1.8, duration: 0.5 }}
            onClick={onComplete}
            className="absolute inset-0 flex items-end justify-center pb-8 z-20"
          >
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="text-white/60 text-xs tracking-widest uppercase"
            >
              Tap to continue
            </motion.span>
          </motion.button>
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

  // Scroll list: each player once, with leading spacer, section spacer before winner, trailing spacer
  type ScrollItem = { type: "row"; row: Row; key: string } | { type: "spacer"; key: string; height: number };
  const scrollItems = useMemo<ScrollItem[]>(() => {
    const items: ScrollItem[] = [];
    items.push({ type: "spacer", key: "spacer-lead", height: LEADING_SPACER_HEIGHT });
    let addedWinnerSpacer = false;
    rowsToReveal.forEach((row) => {
      if (row.position === 1 && !addedWinnerSpacer) {
        items.push({ type: "spacer", key: "spacer-winner", height: SECTION_SPACER_HEIGHT });
        addedWinnerSpacer = true;
      }
      items.push({ type: "row", row, key: row.profile_id });
    });
    items.push({ type: "spacer", key: "spacer-trail", height: SECTION_SPACER_HEIGHT });
    return items;
  }, [rowsToReveal.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalScrollHeight = scrollItems.reduce(
    (sum, item) => sum + (item.type === "spacer" ? item.height : ROW_HEIGHT_WITH_GAP),
    0
  );
  // Stop scroll when winner row is visible at top of viewport
  const scrollTarget = Math.max(0, totalScrollHeight - SECTION_SPACER_HEIGHT - ROW_HEIGHT_WITH_GAP);
  const scrollDuration = Math.max(scrollTarget / 80, 10);

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

      {/* ── Scroll phase ── */}
      {phase === "scroll" && (
        <motion.div key={`scroll-${replayKey}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full">
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
              animate={{ y: [0, -scrollTarget] }}
              transition={{ duration: scrollDuration, ease: "linear" }}
              className="space-y-2 pointer-events-none"
            >
              {scrollItems.map((item) =>
                item.type === "spacer"
                  ? <div key={item.key} style={{ height: item.height }} />
                  : <ScrollRow key={item.key} row={item.row} scoringModel={scoringModel} />
              )}
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
                      ? visibleRows.map((row, i) => <SuspenseCard key={row.profile_id} row={row} delay={i * interval} scoringModel={scoringModel} />)
                      : visibleRows.map((row) => <RevealRow key={row.profile_id} row={row} springProps={springProps} scoringModel={scoringModel} />)}
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

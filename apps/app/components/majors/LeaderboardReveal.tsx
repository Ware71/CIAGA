"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LeaderboardEntryWithProfile, FrozenLeaderboardEntry, LeaderboardRevealStyle } from "@/lib/majors/types";

type Row = LeaderboardEntryWithProfile | FrozenLeaderboardEntry;

type Props = {
  rows: Row[];
  revealStyle: LeaderboardRevealStyle;
  revealTopX: number | null;
  onDone: () => void;
};

const TIMING: Record<LeaderboardRevealStyle, { countdown: number; interval: number }> = {
  none:     { countdown: 0,    interval: 0 },
  animated: { countdown: 3000, interval: 1500 },
  suspense: { countdown: 5000, interval: 2500 },
  rapid:    { countdown: 1500, interval: 400 },
};

const SUSPENSE_COUNTDOWN_LABELS = ["Get ready…", "Almost there…", "Here we go…", "Here we go…"];

const ROW_HEIGHT_PX = 60;

function getProfile(row: Row) {
  return (row as any).profile as { id: string; name: string | null; avatar_url: string | null } | undefined;
}

function getScore(row: Row): number | null {
  return (row as any).net_score ?? (row as any).gross_score ?? null;
}

function RevealRow({ row, springProps }: { row: Row; springProps: object }) {
  const profile = getProfile(row);
  const score = getScore(row);
  const pos = row.position ?? 0;
  const isWinner = pos === 1;
  return (
    <motion.div
      key={row.profile_id}
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
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
      ) : (
        <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
          {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
        </div>
      )}
      <span className={`flex-1 font-semibold truncate ${isWinner ? "text-[#f5e6b0] text-base" : "text-sm text-emerald-50"}`}>
        {profile?.name ?? "Unknown"}
      </span>
      <span className={`font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]"}`}>
        {score ?? "—"}
      </span>
    </motion.div>
  );
}

// Suspense card: slides in as "???" then flips to reveal the player after 1 s
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
          <motion.div
            key="hidden"
            initial={{ rotateY: 0 }}
            exit={{ rotateY: 90 }}
            transition={{ duration: 0.25 }}
            className="flex flex-1 items-center gap-3"
          >
            <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200/40 shrink-0">
              ?
            </div>
            <span className="flex-1 font-semibold text-sm text-emerald-200/40 tracking-widest">— — —</span>
            <span className="font-extrabold text-xs text-[#f5e6b0]/30 shrink-0">??</span>
          </motion.div>
        ) : (
          <motion.div
            key="revealed"
            initial={{ rotateY: -90 }}
            animate={{ rotateY: 0 }}
            transition={{ duration: 0.35, type: "spring", stiffness: 300, damping: 24 }}
            className="flex flex-1 items-center gap-3"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <span className={`flex-1 font-semibold truncate ${isWinner ? "text-[#f5e6b0] text-base" : "text-sm text-emerald-50"}`}>
              {profile?.name ?? "Unknown"}
            </span>
            <span className={`font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]"}`}>
              {score ?? "—"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Static row used in the scroll phase (no entry animation)
function ScrollRow({ row }: { row: Row }) {
  const profile = getProfile(row);
  const score = getScore(row);
  const pos = row.position ?? 0;
  const isWinner = pos === 1;
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
      isWinner
        ? "border-[#f5e6b0]/60 bg-[#f5e6b0]/10"
        : "border-emerald-900/50 bg-[#0b3b21]/70"
    }`}>
      <span className={`w-7 text-center font-extrabold ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]/70"}`}>
        {isWinner ? "🏆" : pos}
      </span>
      {profile?.avatar_url ? (
        <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
      ) : (
        <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
          {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
        </div>
      )}
      <span className={`flex-1 font-semibold truncate ${isWinner ? "text-[#f5e6b0] text-base" : "text-sm text-emerald-50"}`}>
        {profile?.name ?? "Unknown"}
      </span>
      <span className={`font-extrabold shrink-0 ${isWinner ? "text-[#f5e6b0] text-base" : "text-xs text-[#f5e6b0]"}`}>
        {score ?? "—"}
      </span>
    </div>
  );
}

export function LeaderboardReveal({ rows, revealStyle, revealTopX, onDone }: Props) {
  const [phase, setPhase] = useState<"countdown" | "reveal" | "scroll">("countdown");
  const [revealedCount, setRevealedCount] = useState(0);
  const [suspenseLabel, setSuspenseLabel] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const suspenseLabelRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const rowsToReveal = revealTopX != null
    ? rows.filter((r) => (r.position ?? 99) <= revealTopX).sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
    : [...rows].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  const { countdown, interval } = TIMING[revealStyle] ?? TIMING.animated;

  function handleReplay() {
    setPhase("countdown");
    setRevealedCount(0);
    setSuspenseLabel(0);
    setReplayKey((k) => k + 1);
  }

  // Countdown phase
  useEffect(() => {
    if (revealStyle === "none") {
      onDone();
      return;
    }

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
    // replayKey intentionally included to re-fire on replay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealStyle, countdown, onDone, replayKey, phase]);

  // Reveal tick
  useEffect(() => {
    if (phase !== "reveal") return;

    if (revealedCount >= rowsToReveal.length) {
      setPhase("scroll");
      return;
    }

    const t = setTimeout(() => setRevealedCount((c) => c + 1), interval);
    return () => clearTimeout(t);
  }, [phase, revealedCount, rowsToReveal.length, interval]);

  const visibleRows = rowsToReveal.slice(0, revealedCount);

  const springProps = revealStyle === "rapid"
    ? { type: "spring" as const, stiffness: 400, damping: 28 }
    : { type: "spring" as const, stiffness: 260, damping: 22 };

  const scrollDuration = Math.max(rowsToReveal.length * 2.5, 8);
  const scrollHeight = rowsToReveal.length * ROW_HEIGHT_PX;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#051a0d]/95 backdrop-blur-sm">

      {/* Scroll phase */}
      {phase === "scroll" && (
        <motion.div
          key="scroll"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col h-full"
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 pt-5 pb-3 shrink-0">
            <button
              type="button"
              onClick={handleReplay}
              className="text-xs text-emerald-200/40 hover:text-emerald-100 transition-colors"
            >
              ↺ Replay
            </button>
            <p className="text-[#f5e6b0] text-sm font-semibold tracking-widest uppercase">
              {revealTopX != null ? `Top ${revealTopX}` : "Final Results"}
            </p>
            <button
              type="button"
              onClick={onDone}
              className="text-emerald-200/40 hover:text-emerald-100 transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>

          <div className="border-t border-emerald-900/40 mx-4 shrink-0" />

          {/* Scrolling rows */}
          <div className="flex-1 overflow-hidden relative mt-3 px-4">
            <motion.div
              animate={{ y: [0, -scrollHeight] }}
              transition={{ duration: scrollDuration, repeat: Infinity, ease: "linear" }}
              className="space-y-2"
            >
              {/* Render twice for seamless loop */}
              {[...rowsToReveal, ...rowsToReveal].map((row, i) => (
                <ScrollRow key={`${row.profile_id}-${i}`} row={row} />
              ))}
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* Countdown + reveal phases — centred */}
      {phase !== "scroll" && (
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
                      <motion.p
                        key={suspenseLabel}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="text-[#f5e6b0] text-2xl font-bold tracking-widest uppercase"
                      >
                        {SUSPENSE_COUNTDOWN_LABELS[suspenseLabel]}
                      </motion.p>
                    </AnimatePresence>
                    <div className="flex justify-center gap-2">
                      {[0, 1, 2, 3].map((i) => (
                        <motion.div
                          key={i}
                          className="w-2 h-2 rounded-full bg-[#f5e6b0]"
                          animate={{ opacity: [0.15, 1, 0.15], scale: [0.8, 1.2, 0.8] }}
                          transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.45 }}
                        />
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
                        <motion.div
                          key={i}
                          className="w-2 h-2 rounded-full bg-emerald-400"
                          animate={{ opacity: [0.2, 1, 0.2] }}
                          transition={{ duration: revealStyle === "rapid" ? 0.6 : 1.2, repeat: Infinity, delay: i * 0.3 }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {phase === "reveal" && (
              <motion.div
                key={`reveal-${replayKey}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-full max-w-sm px-4 space-y-3"
              >
                <p className="text-center text-[#f5e6b0] text-sm font-semibold tracking-widest uppercase mb-4">
                  {revealTopX != null ? `Top ${revealTopX} Results` : "Final Results"}
                </p>

                <div className="space-y-2">
                  <AnimatePresence>
                    {revealStyle === "suspense"
                      ? visibleRows.map((row, i) => (
                          <SuspenseCard key={row.profile_id} row={row} delay={i * interval} />
                        ))
                      : visibleRows.map((row) => (
                          <RevealRow key={row.profile_id} row={row} springProps={springProps} />
                        ))}
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

"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LeaderboardEntryWithProfile, FrozenLeaderboardEntry, LeaderboardRevealStyle } from "@/lib/majors/types";

type Row = LeaderboardEntryWithProfile | FrozenLeaderboardEntry;

type Props = {
  rows: Row[];
  revealStyle: LeaderboardRevealStyle;
  revealTopX: number | null;
  onDone: () => void;
};

function getProfile(row: Row) {
  return (row as any).profile as { id: string; name: string | null; avatar_url: string | null } | undefined;
}

function getScore(row: Row): number | null {
  return (row as any).net_score ?? (row as any).gross_score ?? null;
}

export function LeaderboardReveal({ rows, revealStyle, revealTopX, onDone }: Props) {
  const [phase, setPhase] = useState<"countdown" | "reveal" | "done">("countdown");
  const [revealedCount, setRevealedCount] = useState(0);

  // Determine which rows to reveal (from last place to first)
  const rowsToReveal = revealTopX != null
    ? rows.filter((r) => (r.position ?? 99) <= revealTopX).sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
    : [...rows].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  const REVEAL_INTERVAL_MS = 1500;
  const COUNTDOWN_MS = 3000;

  useEffect(() => {
    if (revealStyle === "none") {
      onDone();
      return;
    }

    // Countdown phase
    const countdownTimer = setTimeout(() => {
      setPhase("reveal");
    }, COUNTDOWN_MS);

    return () => clearTimeout(countdownTimer);
  }, [revealStyle, onDone]);

  useEffect(() => {
    if (phase !== "reveal") return;

    if (revealedCount >= rowsToReveal.length) {
      const doneTimer = setTimeout(onDone, 2000);
      return () => clearTimeout(doneTimer);
    }

    const timer = setTimeout(() => {
      setRevealedCount((c) => c + 1);
    }, REVEAL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [phase, revealedCount, rowsToReveal.length, onDone]);

  const visibleRows = rowsToReveal.slice(0, revealedCount);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#051a0d]/95 backdrop-blur-sm">
      <AnimatePresence mode="wait">
        {phase === "countdown" && (
          <motion.div
            key="countdown"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.2 }}
            className="text-center space-y-3"
          >
            <p className="text-[#f5e6b0] text-2xl font-bold tracking-widest uppercase">
              Results incoming
            </p>
            <div className="flex justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.4 }}
                />
              ))}
            </div>
          </motion.div>
        )}

        {phase === "reveal" && (
          <motion.div
            key="reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-sm px-4 space-y-3"
          >
            <p className="text-center text-[#f5e6b0] text-sm font-semibold tracking-widest uppercase mb-4">
              {revealTopX != null ? `Top ${revealTopX} Results` : "Final Results"}
            </p>

            <div className="space-y-2">
              <AnimatePresence>
                {visibleRows.map((row) => {
                  const profile = getProfile(row);
                  const score = getScore(row);
                  const pos = row.position ?? 0;
                  const isWinner = pos === 1;

                  return (
                    <motion.div
                      key={row.profile_id}
                      initial={{ opacity: 0, y: 40, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 260, damping: 22 }}
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
                })}
              </AnimatePresence>
            </div>

            {revealedCount >= rowsToReveal.length && rowsToReveal.length > 0 && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
                type="button"
                onClick={onDone}
                className="w-full mt-4 py-2 text-sm text-emerald-200/60 hover:text-emerald-100 transition-colors"
              >
                Close
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

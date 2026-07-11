"use client";

import { createPortal } from "react-dom";

/**
 * Player form popup — the "info" sheet behind every player name on the
 * fantasy board. Data comes from the odds endpoint's `players` block
 * (fantasy_player_profiles), so opening it costs no extra request.
 */

export type PlayerStats = {
  profile_id: string;
  handicap_index: number | null;
  avg_gross: number | null;
  score_stddev: number | null;
  recent_form: number | null;
  birdies_per_round: number | null;
  eagles_per_round: number | null;
  sample_size: number;
  confidence: string;
  recent_rounds:
    | {
        playedAt: string;
        gross18: number;
        birdies: number;
        eagles: number;
        holes: number;
        courseId: string | null;
      }[]
    | null;
};

const num = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : Number(n).toFixed(d);

export function PlayerStatsSheet({
  name,
  stats,
  eventCourseId,
  onClose,
}: {
  name: string;
  stats: PlayerStats | null;
  eventCourseId: string | null;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;

  const recent = stats?.recent_rounds ?? [];
  const lastFive = recent.slice(0, 5);
  const birdiesLastFive = lastFive.reduce((s, r) => s + r.birdies, 0);
  const atCourse = eventCourseId ? recent.filter((r) => r.courseId === eventCourseId) : [];
  const courseBest = atCourse.length > 0 ? Math.min(...atCourse.map((r) => r.gross18)) : null;
  const form = stats?.recent_form != null ? Number(stats.recent_form) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-emerald-900/70 bg-[#07301a] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-sm font-bold text-[#f5e6b0]">{name}</div>
            <div className="text-[10px] text-emerald-200/50">
              {stats
                ? `${stats.sample_size} sampled rounds · ${stats.confidence} confidence`
                : "No performance data yet — priced off handicap"}
            </div>
          </div>
          {form != null && Math.abs(form) >= 1 && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                form < 0
                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  : "bg-red-500/10 text-red-300 border border-red-500/30"
              }`}
            >
              {form < 0 ? "▲ In form" : "▼ Off form"} {Math.abs(form).toFixed(1)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            ["Handicap", num(stats?.handicap_index)],
            ["Avg gross", num(stats?.avg_gross)],
            ["Spread ±", num(stats?.score_stddev)],
            ["Birdies/rd", num(stats?.birdies_per_round)],
            ["Eagles/rd", num(stats?.eagles_per_round, 2)],
            ["Brd last 5", lastFive.length > 0 ? String(birdiesLastFive) : "—"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1.5 text-center">
              <div className="text-[13px] font-bold text-emerald-50">{value}</div>
              <div className="text-[9px] uppercase tracking-wide text-emerald-200/50">{label}</div>
            </div>
          ))}
        </div>

        {courseBest != null && (
          <div className="mb-3 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-[11px] text-emerald-100/80">
            Best at this course (recent rounds):{" "}
            <span className="font-bold text-[#f5e6b0]">{Math.round(courseBest)}</span>
            {" · "}played {atCourse.length}×
          </div>
        )}

        {lastFive.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-emerald-200/50 mb-1.5">
              Recent rounds
            </div>
            <div className="space-y-1">
              {lastFive.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-emerald-900/40 px-2.5 py-1 text-[11px]"
                >
                  <span className="text-emerald-200/60">
                    {new Date(r.playedAt).toLocaleDateString([], { day: "numeric", month: "short" })}
                    {r.holes < 18 ? ` · ${r.holes}h` : ""}
                  </span>
                  <span className="text-emerald-100/85">
                    {r.birdies > 0 ? `${r.birdies} brd · ` : ""}
                    <span className="font-bold text-emerald-50">{Math.round(r.gross18)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

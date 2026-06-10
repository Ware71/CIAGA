"use client";

import type { EventPlayoff } from "@/lib/majors/types";

interface TieBannerProps {
  isAdmin: boolean;
  onManage: () => void;
}

export function TieBanner({ isAdmin, onManage }: TieBannerProps) {
  return (
    <div
      role={isAdmin ? "button" : undefined}
      tabIndex={isAdmin ? 0 : undefined}
      onClick={isAdmin ? onManage : undefined}
      onKeyDown={isAdmin ? (e) => e.key === "Enter" && onManage() : undefined}
      className={`flex items-center gap-3 rounded-xl border border-yellow-600/60 bg-yellow-900/25 px-3 py-2.5 ${
        isAdmin ? "cursor-pointer active:opacity-80" : ""
      }`}
    >
      <span className="text-yellow-400 text-base shrink-0">⚖️</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-yellow-300">Tie for 1st Place</p>
        <p className="text-[10px] text-yellow-300/70">
          {isAdmin
            ? "Tap to resolve — playoff or countback"
            : "Awaiting tie resolution by organiser"}
        </p>
      </div>
      {isAdmin && (
        <span className="text-yellow-400/60 text-sm shrink-0">›</span>
      )}
    </div>
  );
}

interface PlayoffStatusBannerProps {
  playoff: EventPlayoff;
  onView: () => void;
}

export function PlayoffStatusBanner({ playoff, onView }: PlayoffStatusBannerProps) {
  const isComplete = playoff.status === "completed";
  const label = playoff.resolution_type === "countback"
    ? isComplete ? "Tie resolved by countback" : "Countback in progress"
    : isComplete ? "Tie resolved by playoff" : "Playoff in progress";

  return (
    <button
      type="button"
      onClick={onView}
      className="w-full flex items-center gap-3 rounded-xl border border-emerald-700/50 bg-emerald-900/20 px-3 py-2.5 text-left"
    >
      <span className="text-emerald-400 text-base shrink-0">
        {isComplete ? "🏆" : "⛳"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-emerald-300">{label}</p>
        <p className="text-[10px] text-emerald-300/60">Tap to view scorecard</p>
      </div>
      <span className="text-emerald-400/60 text-sm shrink-0">›</span>
    </button>
  );
}

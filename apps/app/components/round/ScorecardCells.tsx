"use client";

import React from "react";
import { isFormatView, type FormatScoreView } from "@/lib/rounds/formatScoring";

// Shared scorecard cell primitives, reused by the round scorecard and the playoff
// scorecard so handicap dots and score badges look identical everywhere.

export type BadgeType = "eagle" | "birdie" | "bogey" | "double" | null;

export function scoreBadgeType(
  s: string | number | null,
  par: number | null,
  scoreView: FormatScoreView = "gross",
  formatIsBadgeable = false,
): BadgeType {
  // For format views, only show badges if the format uses stroke-based scoring (not points)
  if (isFormatView(scoreView) && !formatIsBadgeable) return null;
  if (typeof s !== "number" || typeof par !== "number") return null;
  const diff = s - par;
  if (diff <= -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 1) return "bogey";
  if (diff >= 2) return "double";
  return null;
}

export function BadgeWrap({ type, children }: { type: BadgeType; children: React.ReactNode }) {
  if (!type) return <>{children}</>;
  const cls =
    type === "eagle"
      ? "inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] px-0.5"
      : type === "birdie"
      ? "inline-flex items-center justify-center min-w-[20px] h-5 rounded-full ring-1 ring-[color:var(--sec-accent)] px-0.5"
      : type === "bogey"
      ? "inline-flex items-center justify-center min-w-[20px] h-5 ring-1 ring-white/50 px-0.5"
      : "inline-flex items-center justify-center min-w-[20px] h-5 bg-white/50 px-0.5";
  return <span className={cls}>{children}</span>;
}

export function StrokeDots({ count }: { count: number }) {
  const n = Math.max(0, Math.floor(count || 0));
  if (!n) return null;

  const shown = Math.min(n, 6);
  const extra = n - shown;

  return (
    <span className="inline-flex items-center gap-1">
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--sec-accent)] border border-[color:var(--sec-hair)]"
        />
      ))}
      {extra > 0 ? <span className="text-[10px] text-[color:var(--sec-muted)]">+{extra}</span> : null}
    </span>
  );
}

export function PlusIndicator({ count }: { count: number }) {
  const n = Math.max(0, Math.floor(count || 0));
  if (!n) return null;
  const shown = Math.min(n, 3);
  const extra = n - shown;
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} className="text-[9px] font-bold text-[color:color-mix(in_srgb,var(--sec-accent)_60%,transparent)] leading-none">+</span>
      ))}
      {extra > 0 ? <span className="text-[9px] text-[color:var(--sec-muted)]">+{extra}</span> : null}
    </span>
  );
}

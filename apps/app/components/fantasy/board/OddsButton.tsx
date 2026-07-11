"use client";

import { OddsValue } from "@/components/fantasy/OddsValue";

/**
 * The one odds pill used across the whole event board — table cells, exact-
 * finish/hole rows, match bets. Encapsulates the back/suspend/slip/price-move
 * visual states so every surface stays identical.
 */
export function OddsButton({
  odds,
  inSlip,
  canBack,
  stale,
  flash,
  onClick,
  className,
  title,
}: {
  odds: number;
  inSlip: boolean;
  canBack: boolean;
  stale: boolean;
  flash?: "up" | "down";
  onClick: () => void;
  className?: string;
  /** Native tooltip — e.g. why a selection is blocked for the viewer. */
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={!canBack && !inSlip}
      onClick={onClick}
      title={title}
      className={`shrink-0 min-w-[58px] text-center rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-default ${
        inSlip
          ? "border-[#f5e6b0] bg-[#f5e6b0] text-[#042713]"
          : stale
          ? "border-emerald-900/50 text-emerald-200/40 animate-pulse"
          : flash === "up"
          ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-300"
          : flash === "down"
          ? "border-red-400/50 bg-red-500/10 text-red-300"
          : canBack
          ? "border-emerald-700/50 bg-emerald-950/40 text-[#f5e6b0] hover:bg-emerald-800/40 active:scale-95"
          : "border-emerald-900/50 text-emerald-200/50"
      } ${className ?? ""}`}
    >
      <OddsValue odds={odds} />
    </button>
  );
}

/** Empty placeholder occupying an odds cell's footprint (no price for a pairing). */
export function OddsBlank() {
  return <span className="inline-block min-w-[58px] text-center text-[11px] text-emerald-200/25">—</span>;
}

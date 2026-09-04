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
          ? "border-[color:var(--sec-accent)] bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]"
          : stale
          ? "border-[color:var(--sec-hair)] text-[color:var(--sec-muted)] animate-pulse"
          : flash === "up"
          ? "border-[color:var(--sec-accent)] bg-emerald-500/15 text-[color:var(--sec-good)]"
          : flash === "down"
          ? "border-red-400/50 bg-red-500/10 text-[color:var(--sec-bad)]"
          : canBack
          ? "border-[color:var(--sec-line)] bg-[color:var(--sec-surface)] text-[color:var(--sec-accent)] hover:bg-[color:var(--sec-surface-2)] active:scale-95"
          : "border-[color:var(--sec-hair)] text-[color:var(--sec-muted)]"
      } ${className ?? ""}`}
    >
      <OddsValue odds={odds} />
    </button>
  );
}

/** Empty placeholder occupying an odds cell's footprint (no price for a pairing). */
export function OddsBlank() {
  return <span className="inline-block min-w-[58px] text-center text-[11px] text-[color:var(--sec-muted)]">—</span>;
}

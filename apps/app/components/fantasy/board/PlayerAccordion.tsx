"use client";

import type { ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";

/**
 * Collapsible per-player card used by Exact Finish and Hole Specials. Header
 * shows the player's name (tap opens their stats sheet); body is the caller's
 * ordered selection rows / segmented controls.
 */
export function PlayerAccordion({
  name,
  open,
  onToggle,
  onInfo,
  subtitle,
  children,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  onInfo?: () => void;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] overflow-hidden">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center justify-between px-3 py-2.5 min-w-0"
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[12px] font-semibold text-[color:var(--sec-text)] truncate">{name}</span>
            {subtitle && <span className="text-[10px] text-[color:var(--sec-muted)] truncate">{subtitle}</span>}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-[color:var(--sec-muted)] transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {onInfo && (
          <button
            type="button"
            aria-label={`About ${name}`}
            onClick={onInfo}
            className="px-2.5 text-[color:var(--sec-muted)] hover:text-[color:var(--sec-muted)]"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && <div className="px-3 pb-2.5">{children}</div>}
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";
import type { ResolvedOccurrence } from "@/lib/calendar/types";
import { formatTime } from "@/lib/calendar/dateUtils";
import { chipClasses, ownerColor } from "./eventStyles";

export function EventChip(props: {
  occ: ResolvedOccurrence;
  /** Show a coloured dot per owner when layering multiple calendars. */
  showOwnerDot?: boolean;
  onClick?: (occ: ResolvedOccurrence) => void;
  compact?: boolean;
}) {
  const { occ, showOwnerDot, onClick, compact } = props;
  const label =
    occ.kind === "round"
      ? occ.title ?? "Round"
      : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");

  return (
    <button
      type="button"
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(occ); } : undefined}
      title={label}
      className={cn(
        "flex w-full items-center gap-1 rounded-md px-1.5 text-left truncate",
        compact ? "py-[1px] text-[9px]" : "py-0.5 text-[10px]",
        chipClasses(occ.kind),
        occ.recurring && "opacity-90"
      )}
    >
      {showOwnerDot ? (
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: ownerColor(occ.profileId) }}
        />
      ) : null}
      {!occ.allDay && occ.kind !== "round" ? (
        <span className="shrink-0 opacity-70">{formatTime(occ.start)}</span>
      ) : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

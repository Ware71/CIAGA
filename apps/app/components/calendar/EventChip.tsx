"use client";

import { cn } from "@/lib/utils";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import { formatTime } from "@/lib/calendar/dateUtils";
import { occChipClasses } from "./eventStyles";
import { InitialsAvatar } from "./Avatar";

export function EventChip(props: {
  occ: ResolvedOccurrence;
  /** When set (shared views), show whose event this is. */
  owner?: ProfileLite;
  onClick?: (occ: ResolvedOccurrence) => void;
  compact?: boolean;
}) {
  const { occ, owner, onClick, compact } = props;
  const isFinished = occ.kind === "round" && occ.roundStatus === "finished";
  const label =
    occ.kind === "round"
      ? occ.courseName ?? occ.title ?? "Round"
      : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");

  const timeLabel = occ.allDay || isFinished
    ? null
    : `${formatTime(occ.start)}${occ.kind !== "round" ? `–${formatTime(occ.end)}` : ""}`;

  return (
    <button
      type="button"
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(occ); } : undefined}
      title={label}
      className={cn(
        "flex w-full items-center gap-1 rounded-lg px-1.5 text-left shadow-sm shadow-black/10 transition-transform active:scale-[0.98]",
        compact ? "py-[1px] text-[9px]" : "py-0.5 text-[10px]",
        occChipClasses(occ),
        occ.recurring && "border-dashed"
      )}
    >
      {owner ? (
        <InitialsAvatar profileId={owner.id} name={owner.name} size={compact ? 12 : 14} />
      ) : null}
      {timeLabel ? <span className="shrink-0 opacity-70">{timeLabel}</span> : null}
      <span className="truncate">{label}</span>
      {occ.resultLabel ? (
        <span className="ml-auto shrink-0 font-bold tabular-nums">{occ.resultLabel}</span>
      ) : null}
    </button>
  );
}

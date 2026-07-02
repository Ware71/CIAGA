"use client";

import { cn } from "@/lib/utils";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import { formatTime, playersLabel } from "@/lib/calendar/dateUtils";
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
  const isRound = occ.kind === "round";
  const isFinished = isRound && occ.roundStatus === "finished";
  const label = isRound
    ? occ.courseName ?? occ.title ?? "Round"
    : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");

  const timeLabel = occ.allDay || isFinished
    ? null
    : `${formatTime(occ.start)}${occ.kind !== "round" ? `–${formatTime(occ.end)}` : ""}`;

  const players = isRound ? playersLabel(occ.playerNames) : "";
  const titleAttr = [label, players, occ.resultLabel].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(occ); } : undefined}
      title={titleAttr}
      className={cn(
        // @container drives progressive disclosure by the chip's own width.
        "@container flex w-full items-center gap-1 overflow-hidden rounded-lg px-1.5 text-left shadow-sm shadow-black/10 transition-transform active:scale-[0.98]",
        compact ? "py-[1px] text-[9px]" : "py-0.5 text-[10px]",
        occChipClasses(occ),
        occ.recurring && "border-dashed"
      )}
    >
      {owner ? (
        <InitialsAvatar profileId={owner.id} name={owner.name} size={compact ? 12 : 14} />
      ) : null}
      {timeLabel ? (
        <span className="hidden shrink-0 opacity-70 @min-[92px]:inline">{timeLabel}</span>
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
      {players ? (
        <span className="hidden min-w-0 truncate opacity-70 @min-[132px]:inline">· {players}</span>
      ) : null}
      {occ.resultLabel ? (
        <span className="ml-auto shrink-0 pl-1 font-bold tabular-nums">{occ.resultLabel}</span>
      ) : null}
    </button>
  );
}

"use client";

import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import { formatTime, playersLabel } from "@/lib/calendar/dateUtils";
import { occChipClasses } from "./eventStyles";
import { InitialsAvatar, AvatarStack } from "./Avatar";

export function EventChip(props: {
  occ: ResolvedOccurrence;
  /** When set (shared views), show whose event this is (availability only). */
  owner?: ProfileLite;
  onClick?: (occ: ResolvedOccurrence) => void;
  compact?: boolean;
}) {
  const { occ, owner, onClick, compact } = props;
  const isRound = occ.kind === "round";
  const avSize = compact ? 12 : 14;

  const label = isRound
    ? occ.courseName ?? occ.title ?? "Round"
    : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");

  const players = isRound ? occ.playerNames ?? [] : [];
  const timeLabel =
    isRound || occ.allDay ? null : `${formatTime(occ.start)}–${formatTime(occ.end)}`;
  const titleAttr = [label, playersLabel(players), occ.resultLabel].filter(Boolean).join(" · ");

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
      {isRound ? (
        players.length >= 2 ? (
          <AvatarStack people={players.map((n) => ({ seed: n, name: n }))} size={avSize} max={3} />
        ) : (
          <Flag size={compact ? 10 : 12} className="shrink-0" />
        )
      ) : owner ? (
        <InitialsAvatar profileId={owner.id} name={owner.name} size={avSize} />
      ) : null}

      {timeLabel ? (
        <span className="hidden shrink-0 opacity-70 @min-[92px]:inline">{timeLabel}</span>
      ) : null}

      {/* Course name only when there's room — never show a 1–2 letter stub. */}
      <span
        className={cn(
          "min-w-0 truncate",
          isRound && "hidden @min-[72px]:inline"
        )}
      >
        {label}
      </span>

      {occ.resultLabel ? (
        <span className="ml-auto shrink-0 pl-1 font-bold tabular-nums">{occ.resultLabel}</span>
      ) : null}
    </button>
  );
}

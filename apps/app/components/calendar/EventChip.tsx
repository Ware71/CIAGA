"use client";

import { Flag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import { formatTime } from "@/lib/calendar/dateUtils";
import { accentColor } from "./eventStyles";
import { InitialsAvatar, AvatarStack } from "./Avatar";

export function formatDiff(diff: number | null | undefined): string | null {
  if (diff == null) return null;
  return diff >= 0 ? `+${diff}` : `${diff}`;
}

/** A flat, Outlook-style accent-bar row (no filled pill). */
export function EventChip(props: {
  occ: ResolvedOccurrence;
  /** When set (shared views), show whose event this is (availability only). */
  owner?: ProfileLite;
  onClick?: (occ: ResolvedOccurrence) => void;
  compact?: boolean;
}) {
  const { occ, owner, onClick, compact } = props;
  const isRound = occ.kind === "round";
  const isEvent = occ.kind === "event";
  const accent = accentColor(occ);
  const avSize = compact ? 12 : 14;

  const label = isRound
    ? occ.title ?? occ.courseName ?? "Round"
    : isEvent
      ? occ.title ?? "Event"
      : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");

  const players = isRound ? occ.playerNames ?? [] : [];
  const timeLabel = isEvent
    ? occ.tbc
      ? "TBC"
      : formatTime(occ.start)
    : isRound || occ.allDay
      ? null
      : `${formatTime(occ.start)}–${formatTime(occ.end)}`;
  const diffText = formatDiff(occ.scoreDiff);

  return (
    <button
      type="button"
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(occ); } : undefined}
      title={[label, occ.groupName, occ.resultLabel, diffText].filter(Boolean).join(" · ")}
      style={{ borderLeftColor: accent }}
      className={cn(
        // @container drives progressive disclosure by the chip's own width.
        "@container flex w-full items-center gap-1.5 overflow-hidden rounded-r-md border-l-[3px] bg-white/[0.04] pr-1 pl-1.5 text-left text-emerald-50/90 transition-colors hover:bg-white/[0.08]",
        occ.kind === "event" && occ.eventStatus === "draft" && "border-dashed opacity-80",
        compact ? "py-[1px] text-[9px]" : "py-0.5 text-[10px]"
      )}
    >
      {isEvent ? (
        <Trophy size={compact ? 10 : 12} className="shrink-0" style={{ color: accent }} />
      ) : isRound ? (
        players.length >= 2 ? (
          <AvatarStack people={players.map((n) => ({ seed: n, name: n }))} size={avSize} max={3} />
        ) : (
          <Flag size={compact ? 10 : 12} className="shrink-0" style={{ color: accent }} />
        )
      ) : owner ? (
        <InitialsAvatar profileId={owner.id} name={owner.name} size={avSize} />
      ) : null}

      {timeLabel ? (
        <span className="hidden shrink-0 opacity-60 @min-[92px]:inline">{timeLabel}</span>
      ) : null}

      {/* Round course name only when there's room — never show a 1–2 letter stub. */}
      <span className={cn("min-w-0 truncate", isRound && "hidden @min-[72px]:inline")}>{label}</span>

      {isEvent && occ.eventStatus === "draft" ? (
        <span className="ml-auto hidden shrink-0 rounded bg-white/10 px-1 text-[8px] uppercase tracking-wide opacity-80 @min-[120px]:inline">
          Draft
        </span>
      ) : occ.resultLabel ? (
        <span className="ml-auto flex shrink-0 items-baseline gap-1 pl-1">
          <span className="font-bold tabular-nums">{occ.resultLabel}</span>
          {diffText ? <span className="opacity-60 tabular-nums">{diffText}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

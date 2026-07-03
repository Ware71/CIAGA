"use client";

import { Flag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import { formatTime, playersLabel } from "@/lib/calendar/dateUtils";
import { accentColor } from "./eventStyles";
import { formatDiff } from "./EventChip";
import { AvatarStack, InitialsAvatar } from "./Avatar";

/** Human label for a round format_type enum value, e.g. "team_scramble" → "Scramble". */
function formatLabel(fmt: string | null | undefined): string | null {
  if (!fmt) return null;
  const base = fmt.replace(/^team_/, "").replace(/_/g, " ");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function statusLabel(occ: ResolvedOccurrence): string | null {
  if (occ.kind === "event") return occ.eventStatus === "confirmed" ? "Confirmed" : "Draft";
  switch (occ.roundStatus) {
    case "live":
    case "starting":
      return "Live";
    case "scheduled":
      return "Scheduled";
    case "finished":
      return "Finished";
    default:
      return null;
  }
}

/**
 * Full-detail round / Major-event card used at the deepest (Day) zoom. Renders
 * the inner content only — the time-grid positions & handles clicks on it.
 */
export function RoundCard(props: {
  occ: ResolvedOccurrence;
  owner?: ProfileLite;
  /** Constrain to a single compact line when the block is short. */
  tight?: boolean;
}) {
  const { occ, owner, tight } = props;
  const isRound = occ.kind === "round";
  const isEvent = occ.kind === "event";
  const accent = accentColor(occ);
  const players = isRound ? occ.playerNames ?? [] : [];
  const title = isRound
    ? occ.title ?? occ.courseName ?? "Round"
    : isEvent
      ? occ.title ?? "Event"
      : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");

  const time = isEvent && occ.tbc ? "TBC" : occ.allDay ? null : formatTime(occ.start);
  const fmt = isRound ? formatLabel(occ.formatType) : null;
  const status = statusLabel(occ);
  const diffText = formatDiff(occ.scoreDiff);
  const metaBits = [time, fmt, isEvent ? occ.groupName : null].filter(Boolean) as string[];

  return (
    <div className="flex h-full w-full flex-col gap-0.5 overflow-hidden">
      <div className="flex min-w-0 items-center gap-1.5">
        {isEvent ? (
          <Trophy size={13} className="shrink-0" style={{ color: accent }} />
        ) : isRound ? (
          players.length >= 2 ? (
            <AvatarStack people={players.map((n) => ({ seed: n, name: n }))} size={15} max={4} />
          ) : (
            <Flag size={13} className="shrink-0" style={{ color: accent }} />
          )
        ) : owner ? (
          <InitialsAvatar profileId={occ.profileId} name={owner.name} size={14} />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight">
          {title}
        </span>
        {occ.resultLabel ? (
          <span className="ml-auto flex shrink-0 items-baseline gap-0.5">
            <span className="text-[13px] font-bold tabular-nums">{occ.resultLabel}</span>
            {diffText ? (
              <span className="text-[9px] opacity-60 tabular-nums">{diffText}</span>
            ) : null}
          </span>
        ) : status ? (
          <span className="ml-auto shrink-0 rounded bg-black/15 px-1 text-[8px] font-medium uppercase tracking-wide opacity-80">
            {status}
          </span>
        ) : null}
      </div>

      {!tight && metaBits.length > 0 ? (
        <div className="truncate text-[10px] opacity-70 leading-tight">{metaBits.join(" · ")}</div>
      ) : null}

      {!tight && isRound && players.length > 0 ? (
        <div className="mt-auto truncate text-[9px] opacity-55 leading-tight">
          {playersLabel(players)}
        </div>
      ) : null}
    </div>
  );
}

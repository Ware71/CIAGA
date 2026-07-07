"use client";

import { Flag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AvailabilityFilter,
  Density,
  ProfileLite,
  ResolvedOccurrence,
} from "@/lib/calendar/types";
import { endOfDay, isToday, startOfDay } from "@/lib/calendar/dateUtils";
import {
  applyAvailabilityFilter,
  dayFilterState,
  dayHeat,
  hasUsableWindow,
  resolveDayPlayerStatuses,
} from "@/lib/calendar/recurrence";
import { STATUS_COLORS, REMOVED_CELL_STYLE, REMOVED_CELL_CLASS, accentColor } from "../eventStyles";
import { EventChip, formatDiff } from "../EventChip";
import { AvatarStack } from "../Avatar";

const MAX_DOTS = 6;

/** Green/red tint for a day's aggregate free-ness (matches the old month heat). */
function heatStyle(heat: number): React.CSSProperties {
  if (heat > 0.01) return { backgroundColor: `rgba(52,211,153,${(0.06 + heat * 0.2).toFixed(3)})` };
  if (heat < -0.01) return { backgroundColor: `rgba(239,68,68,${(0.06 - heat * 0.2).toFixed(3)})` };
  return {};
}

/** How many round/event blocks a density can show before collapsing to "+N". */
function maxBlocks(density: Density): number {
  return density === "pip" ? 3 : density === "compact" ? 2 : 3;
}

/**
 * One day within a transposed grid. Encapsulates all of MonthView's per-cell
 * logic (heat tint, today ring, finished-round tiles, availability dots) plus
 * the new round/event cards (icon → chip by density) and the filter cell-states
 * ("removed" hatch vs plain "empty"). The grid places it; the cell fills 100%.
 */
export function DayCell(props: {
  day: Date;
  /** Full (unfiltered) occurrences for the displayed people. */
  occurrences: ResolvedOccurrence[];
  profileIds: string[];
  filter: AvailabilityFilter;
  applyThreeHour: boolean;
  density: Density;
  nameById: Map<string, ProfileLite>;
  showOwners: boolean;
  /** Dim out-of-scope days (month spill-over); always true in fixed-week grids. */
  inScope?: boolean;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
  onEmptyClick: (day: Date) => void;
}) {
  const {
    day,
    occurrences,
    profileIds,
    filter,
    applyThreeHour,
    density,
    nameById,
    showOwners,
    inScope = true,
    onOccurrenceClick,
    onEmptyClick,
  } = props;

  const ds = startOfDay(day).getTime();
  const de = endOfDay(day).getTime();
  const isPast = ds < startOfDay(new Date()).getTime();
  const singleView = profileIds.length <= 1;

  const dayOccs = occurrences.filter(
    (o) => profileIds.includes(o.profileId) && o.end.getTime() > ds && o.start.getTime() < de
  );
  const filterState = dayFilterState(dayOccs, filter);
  const shown = applyAvailabilityFilter(dayOccs, filter);

  // Future: heat tint + player dots. Past: finished-round tiles.
  const statuses = isPast ? null : resolveDayPlayerStatuses(occurrences, profileIds, day);
  const usable = isPast || !applyThreeHour ? true : hasUsableWindow(occurrences, profileIds, day);
  const heat = statuses ? dayHeat(statuses) : 0;
  const cellStyle: React.CSSProperties =
    !isPast && statuses
      ? usable
        ? heatStyle(heat)
        : { backgroundColor: "rgba(239,68,68,0.14)" }
      : {};

  const pastRounds = isPast
    ? dayOccs.filter((o) => o.kind === "round").slice(0, 2)
    : [];
  const roundEvents = shown
    .filter((o) => o.kind === "round" || o.kind === "event")
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const avails = shown.filter((o) => o.kind === "available");
  const dots = statuses ? profileIds.map((id) => statuses.get(id) ?? "none") : [];

  const removed = filterState === "removed";
  const cap = maxBlocks(density);
  const shownBlocks = roundEvents.slice(0, cap);
  const extraBlocks = roundEvents.length - shownBlocks.length;
  const isPip = density === "pip";
  const isCompact = density === "compact";

  return (
    <button
      type="button"
      onClick={() => onEmptyClick(day)}
      style={removed ? REMOVED_CELL_STYLE : cellStyle}
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border p-1 text-left transition-colors hover:bg-emerald-900/20",
        inScope ? "border-emerald-900/50" : "border-emerald-900/40 bg-[#0b3b21]/10",
        removed && REMOVED_CELL_CLASS,
        isToday(day) && "ring-1 ring-[#f5e6b0]/60"
      )}
    >
      <div className="mb-0.5 flex items-center justify-between">
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
            isToday(day)
              ? "bg-[#f5e6b0] font-bold text-[#042713]"
              : inScope
                ? "text-emerald-100/80"
                : "text-emerald-100/40"
          )}
        >
          {day.getDate()}
        </span>
        {/* pip density shows round/event icons in the corner row */}
        {!isPast && !removed && isPip && roundEvents.length > 0 ? (
          <span className="flex items-center gap-0.5">
            {roundEvents.slice(0, 3).map((occ) => (
              <span
                key={occ.key}
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOccurrenceClick(occ);
                }}
              >
                {occ.kind === "event" ? (
                  <Trophy size={11} style={{ color: accentColor(occ) }} />
                ) : (
                  <Flag size={11} style={{ color: accentColor(occ) }} />
                )}
              </span>
            ))}
            {roundEvents.length > 3 ? (
              <span className="text-[8px] text-emerald-200/60">+{roundEvents.length - 3}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      {isPast ? (
        <PastTiles rounds={pastRounds} singleView={singleView} onOpen={onOccurrenceClick} />
      ) : removed ? null : (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          {/* compact / medium densities show named chips */}
          {!isPip
            ? shownBlocks.map((occ) => (
                <EventChip
                  key={occ.key}
                  occ={occ}
                  compact={isCompact}
                  owner={showOwners ? nameById.get(occ.profileId) : undefined}
                  onClick={onOccurrenceClick}
                />
              ))
            : null}
          {!isPip && extraBlocks > 0 ? (
            <div className="text-[8px] text-emerald-200/60">+{extraBlocks} more</div>
          ) : null}

          {/* availability: dots at pip, an "Available" chip when there's room */}
          {isPip && dots.length > 0 ? (
            <div className="mt-auto flex flex-wrap gap-0.5">
              {dots.slice(0, MAX_DOTS).map((s, i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLORS[s] }}
                />
              ))}
              {dots.length > MAX_DOTS ? (
                <span className="text-[8px] leading-none text-emerald-200/60">
                  +{dots.length - MAX_DOTS}
                </span>
              ) : null}
            </div>
          ) : !isPip && avails.length > 0 ? (
            <EventChip
              occ={avails[0]}
              compact={isCompact}
              owner={showOwners ? nameById.get(avails[0].profileId) : undefined}
              onClick={onOccurrenceClick}
            />
          ) : null}
        </div>
      )}
    </button>
  );
}

/** Finished-round score tiles for a past day (carried over from MonthView). */
function PastTiles(props: {
  rounds: ResolvedOccurrence[];
  singleView: boolean;
  onOpen: (occ: ResolvedOccurrence) => void;
}) {
  const { rounds, singleView, onOpen } = props;
  if (rounds.length === 0) return null;
  const one = rounds.length === 1;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5">
      {rounds.map((occ) => {
        const showScore = singleView || occ.selfParticipated;
        const diffText = formatDiff(occ.scoreDiff);
        return (
          <button
            key={occ.key}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(occ);
            }}
            className="flex min-h-0 flex-1 items-center justify-center rounded bg-[#f5e6b0]/10"
          >
            {showScore && occ.resultLabel ? (
              one ? (
                <span className="flex flex-col items-center leading-none text-[#f5e6b0]">
                  <span className="text-lg font-bold tabular-nums">{occ.resultLabel}</span>
                  {diffText ? (
                    <span className="mt-0.5 text-[10px] tabular-nums opacity-70">{diffText}</span>
                  ) : null}
                </span>
              ) : (
                <span className="flex items-baseline gap-0.5 text-[#f5e6b0]">
                  <span className="text-xs font-bold tabular-nums">{occ.resultLabel}</span>
                  {diffText ? (
                    <span className="text-[8px] tabular-nums opacity-70">{diffText}</span>
                  ) : null}
                </span>
              )
            ) : (occ.playerNames?.length ?? 0) > 0 ? (
              <AvatarStack
                people={(occ.playerNames ?? []).map((n) => ({ seed: n, name: n }))}
                size={one ? 22 : 16}
                max={3}
              />
            ) : (
              <span className="text-[9px] text-emerald-200/60">Round</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

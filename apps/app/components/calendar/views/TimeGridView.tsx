"use client";

import { useEffect, useMemo, useRef } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AvailabilityFilter,
  ProfileLite,
  ResolvedOccurrence,
} from "@/lib/calendar/types";
import {
  dayKey,
  endOfDay,
  formatColumnHeader,
  formatHourLabel,
  formatTime,
  isToday,
  startOfDay,
} from "@/lib/calendar/dateUtils";
import { resolveDayIntervals } from "@/lib/calendar/recurrence";
import { occChipClasses } from "../eventStyles";
import { EventChip } from "../EventChip";
import { InitialsAvatar, AvatarStack } from "../Avatar";

const HOUR_PX = 52;
const GUTTER = 40;
const CENTER_HOUR = 13; // midday-ish, centred on open
const MIN_BLOCK_PX = 20;

type Positioned = { occ: ResolvedOccurrence; top: number; height: number; lane: number; lanes: number };

/** Greedy lane packing so overlapping blocks sit side by side within a column. */
function packDay(occs: ResolvedOccurrence[], day: Date): Positioned[] {
  const dStart = startOfDay(day).getTime();
  const dEnd = endOfDay(day).getTime();
  const items = occs
    .map((occ) => {
      const s = Math.max(occ.start.getTime(), dStart);
      const e = Math.min(occ.end.getTime(), dEnd);
      return { occ, startMin: (s - dStart) / 60000, endMin: (e - dStart) / 60000 };
    })
    .filter((it) => it.endMin > it.startMin)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const laneEnds: number[] = [];
  const laneOf = new Map<ResolvedOccurrence, number>();
  for (const it of items) {
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endMin);
    } else {
      laneEnds[lane] = it.endMin;
    }
    laneOf.set(it.occ, lane);
  }
  const lanes = Math.max(1, laneEnds.length);
  return items.map((it) => ({
    occ: it.occ,
    top: (it.startMin / 60) * HOUR_PX,
    height: Math.max(MIN_BLOCK_PX, ((it.endMin - it.startMin) / 60) * HOUR_PX),
    lane: laneOf.get(it.occ) ?? 0,
    lanes,
  }));
}

export function TimeGridView(props: {
  days: Date[];
  occurrences: ResolvedOccurrence[];
  profileIds: string[];
  filter: AvailabilityFilter;
  nameById: Map<string, ProfileLite>;
  showOwners: boolean;
  onSlotClick: (day: Date, hour: number) => void;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
}) {
  const { days, occurrences, profileIds, filter, nameById, showOwners, onSlotClick, onOccurrenceClick } =
    props;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, CENTER_HOUR * HOUR_PX - el.clientHeight / 2);
  }, []);

  const colW = days.length <= 2 ? 176 : days.length <= 3 ? 140 : 128;
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const gridOccs = useMemo(
    () =>
      occurrences.filter((o) => {
        if (filter === "available_only") return o.kind === "available";
        if (filter === "hide_unavailable") return o.kind !== "unavailable";
        return true;
      }),
    [occurrences, filter]
  );

  const perDay = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return days.map((day) => {
      const ds = startOfDay(day).getTime();
      const de = endOfDay(day).getTime();
      const onDay = gridOccs.filter((o) => o.end.getTime() > ds && o.start.getTime() < de);
      const allDay = onDay.filter((o) => o.allDay || (o.start.getTime() <= ds && o.end.getTime() >= de));
      const timed = onDay.filter((o) => !allDay.includes(o));
      const intervals =
        ds < today ? { busy: [], available: [] } : resolveDayIntervals(occurrences, profileIds, day);
      return { day, allDay, positioned: packDay(timed, day), intervals };
    });
  }, [days, gridOccs, occurrences, profileIds]);

  const showBusyShade = filter === "all";

  return (
    <div
      ref={scrollRef}
      className="max-h-[66vh] overflow-auto rounded-2xl border border-emerald-900/60 bg-[#052a17]/40 landscape:max-h-[86vh]"
    >
      <div style={{ minWidth: GUTTER + days.length * colW }}>
        {/* Sticky day header + all-day chips */}
        <div className="sticky top-0 z-20 flex border-b border-emerald-900/60 bg-[#04240f]/95 backdrop-blur">
          <div className="sticky left-0 z-10 shrink-0 bg-[#04240f]/95" style={{ width: GUTTER }} />
          {perDay.map(({ day, allDay }) => {
            const { weekday, day: dnum } = formatColumnHeader(day);
            return (
              <div
                key={dayKey(day)}
                className="shrink-0 border-l border-emerald-900/40 px-1 py-1.5"
                style={{ width: colW }}
              >
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase tracking-wide text-emerald-200/50">
                    {weekday}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                      isToday(day) ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-50"
                    )}
                  >
                    {dnum}
                  </span>
                </div>
                {allDay.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {allDay.map((occ) => (
                      <EventChip
                        key={occ.key}
                        occ={occ}
                        compact
                        owner={showOwners ? nameById.get(occ.profileId) : undefined}
                        onClick={onOccurrenceClick}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Body: hour gutter + day columns */}
        <div className="flex">
          <div className="sticky left-0 z-10 shrink-0 bg-[#052a17]/80" style={{ width: GUTTER }}>
            {hours.map((h) => (
              <div
                key={h}
                style={{ height: HOUR_PX }}
                className="relative -top-1.5 pr-1 text-right text-[10px] text-emerald-200/45"
              >
                {h === 0 ? "" : formatHourLabel(h)}
              </div>
            ))}
          </div>

          {perDay.map(({ day, positioned, intervals }) => (
            <div
              key={dayKey(day)}
              className="relative shrink-0 border-l border-emerald-900/40"
              style={{ width: colW, height: 24 * HOUR_PX }}
            >
              {/* hour rows / tap targets */}
              {hours.map((h) => (
                <button
                  key={h}
                  onClick={() => onSlotClick(day, h)}
                  className="block w-full border-t border-emerald-900/20 hover:bg-emerald-500/5"
                  style={{ height: HOUR_PX }}
                  aria-label={`Add at ${formatHourLabel(h)}`}
                />
              ))}

              {/* availability shading */}
              {intervals.available.map((iv, i) => (
                <div
                  key={`a${i}`}
                  className="pointer-events-none absolute inset-x-0 bg-emerald-400/15"
                  style={{ top: (iv.start / 60) * HOUR_PX, height: ((iv.end - iv.start) / 60) * HOUR_PX }}
                />
              ))}
              {showBusyShade
                ? intervals.busy.map((iv, i) => (
                    <div
                      key={`b${i}`}
                      className="pointer-events-none absolute inset-x-0 bg-slate-500/20"
                      style={{
                        top: (iv.start / 60) * HOUR_PX,
                        height: ((iv.end - iv.start) / 60) * HOUR_PX,
                      }}
                    />
                  ))
                : null}

              {/* timed blocks */}
              {positioned.map(({ occ, top, height, lane, lanes }) => {
                const owner = showOwners ? nameById.get(occ.profileId) : undefined;
                const widthPct = 100 / lanes;
                const wPx = (colW * widthPct) / 100;
                const isRound = occ.kind === "round";
                const players = isRound ? occ.playerNames ?? [] : [];
                // Only show the course name when it actually fits — no 1–2 letter stubs.
                const showName = !isRound || wPx >= 64;
                const primary = isRound
                  ? occ.courseName ?? occ.title ?? "Round"
                  : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");
                const showSecondLine = height >= 34;
                const secondLine = occ.resultLabel
                  ? `Gross ${occ.resultLabel}`
                  : !occ.allDay
                    ? formatTime(occ.start)
                    : "";
                const inlineResult = occ.resultLabel && !showSecondLine;

                return (
                  <button
                    key={occ.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOccurrenceClick(occ);
                    }}
                    className={cn(
                      "absolute flex flex-col overflow-hidden rounded-md px-1 py-0.5 text-left shadow-sm shadow-black/20",
                      occChipClasses(occ),
                      occ.recurring && "border-dashed"
                    )}
                    style={{
                      top,
                      height,
                      left: `calc(${lane * widthPct}% + 1px)`,
                      width: `calc(${widthPct}% - 2px)`,
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      {isRound ? (
                        players.length >= 2 ? (
                          <AvatarStack
                            people={players.map((n) => ({ seed: n, name: n }))}
                            size={13}
                            max={3}
                          />
                        ) : (
                          <Flag size={11} className="shrink-0" />
                        )
                      ) : owner ? (
                        <InitialsAvatar profileId={occ.profileId} name={owner.name} size={12} />
                      ) : null}
                      {showName ? (
                        <span className="min-w-0 truncate text-[11px] font-medium leading-tight">
                          {primary}
                        </span>
                      ) : null}
                      {inlineResult ? (
                        <span className="ml-auto shrink-0 text-[11px] font-bold tabular-nums">
                          {occ.resultLabel}
                        </span>
                      ) : null}
                    </div>
                    {showSecondLine && secondLine ? (
                      <span className="mt-auto min-w-0 truncate text-[9px] opacity-60 leading-tight">
                        {secondLine}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

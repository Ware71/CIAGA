"use client";

import { useEffect, useMemo, useRef } from "react";
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
import { chipClasses } from "../eventStyles";
import { InitialsAvatar } from "../Avatar";

const HOUR_PX = 46;
const DEFAULT_SCROLL_HOUR = 6;
const MIN_BLOCK_PX = 22;

type Positioned = { occ: ResolvedOccurrence; top: number; height: number; lane: number; lanes: number };

/** Greedy lane packing so overlapping blocks sit side by side. */
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
    if (scrollRef.current) scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_PX;
  }, []);

  const colW = days.length <= 2 ? 168 : days.length <= 3 ? 128 : 92;
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Filter occurrences for the grid (per-occurrence, not day-level).
  const gridOccs = useMemo(
    () =>
      occurrences.filter((o) => {
        if (filter === "available_only") return o.kind === "available";
        if (filter === "hide_unavailable") return !o.busy;
        return true;
      }),
    [occurrences, filter]
  );

  const perDay = useMemo(() => {
    return days.map((day) => {
      const ds = startOfDay(day).getTime();
      const de = endOfDay(day).getTime();
      const onDay = gridOccs.filter((o) => o.end.getTime() > ds && o.start.getTime() < de);
      const allDay = onDay.filter(
        (o) => o.allDay || (o.start.getTime() <= ds && o.end.getTime() >= de)
      );
      const timed = onDay.filter((o) => !allDay.includes(o));
      const intervals = resolveDayIntervals(occurrences, profileIds, day);
      return { day, allDay, positioned: packDay(timed, day), intervals };
    });
  }, [days, gridOccs, occurrences, profileIds]);

  const showBusyShade = filter === "all";

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-2xl border border-emerald-900/60 bg-[#052a17]/50"
      style={{ maxHeight: "66vh" }}
    >
      <div style={{ minWidth: 44 + days.length * colW }}>
        {/* Header row: day labels + all-day strip */}
        <div className="sticky top-0 z-20 flex border-b border-emerald-900/60 bg-[#04240f]/95 backdrop-blur">
          <div className="sticky left-0 z-10 w-11 shrink-0 bg-[#04240f]/95" />
          {perDay.map(({ day, allDay }) => {
            const { weekday, day: dnum } = formatColumnHeader(day);
            const today = isToday(day);
            return (
              <div
                key={dayKey(day)}
                className="shrink-0 border-l border-emerald-900/40 px-1 py-1.5"
                style={{ width: colW }}
              >
                <div className="flex flex-col items-center">
                  <span className="text-[9px] uppercase tracking-wide text-emerald-200/50">
                    {weekday}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                      today ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-50"
                    )}
                  >
                    {dnum}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {allDay.map((occ) => (
                    <button
                      key={occ.key}
                      onClick={() => onOccurrenceClick(occ)}
                      className={cn(
                        "flex w-full items-center gap-0.5 truncate rounded px-1 py-[1px] text-[8px]",
                        chipClasses(occ.kind),
                        occ.recurring && "border-dashed"
                      )}
                    >
                      {showOwners && nameById.get(occ.profileId) ? (
                        <InitialsAvatar
                          profileId={occ.profileId}
                          name={nameById.get(occ.profileId)!.name}
                          size={10}
                        />
                      ) : null}
                      <span className="truncate">
                        {occ.title ?? (occ.kind === "available" ? "Available" : occ.kind === "round" ? "Round" : "Busy")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Body: hour gutter + day columns */}
        <div className="flex">
          <div className="sticky left-0 z-10 w-11 shrink-0 bg-[#052a17]/80">
            {hours.map((h) => (
              <div
                key={h}
                style={{ height: HOUR_PX }}
                className="relative -top-1.5 pr-1 text-right text-[9px] text-emerald-200/45"
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
              {/* hour gridlines + tap targets */}
              {hours.map((h) => (
                <button
                  key={h}
                  onClick={() => onSlotClick(day, h)}
                  className="block w-full border-t border-emerald-900/25 hover:bg-emerald-500/5"
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
                return (
                  <button
                    key={occ.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOccurrenceClick(occ);
                    }}
                    className={cn(
                      "absolute overflow-hidden rounded-md px-1 text-left shadow-sm shadow-black/20",
                      chipClasses(occ.kind),
                      occ.recurring && "border-dashed"
                    )}
                    style={{
                      top,
                      height,
                      left: `calc(${lane * widthPct}% + 1px)`,
                      width: `calc(${widthPct}% - 2px)`,
                    }}
                  >
                    <div className="flex items-center gap-0.5">
                      {owner ? (
                        <InitialsAvatar profileId={occ.profileId} name={owner.name} size={11} />
                      ) : null}
                      <span className="truncate text-[9px] font-medium leading-tight">
                        {occ.title ?? (occ.kind === "available" ? "Available" : occ.kind === "round" ? "Round" : "Busy")}
                      </span>
                    </div>
                    {height > 30 ? (
                      <div className="truncate text-[8px] opacity-70 leading-tight">
                        {formatTime(occ.start)}
                      </div>
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

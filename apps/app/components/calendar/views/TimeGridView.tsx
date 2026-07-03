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

const HOUR_PX = 40;
const GUTTER = 40;
const CENTER_HOUR = 13; // midday-ish, centred on open
const MIN_BLOCK_PX = 18;

// Horizontal (landscape) day-row window.
const WIN_START_H = 6;
const WIN_END_H = 23;
const WIN_START = WIN_START_H * 60;
const WIN_SPAN = (WIN_END_H - WIN_START_H) * 60;
const LANE_H = 22;
const H_LABEL_W = 44;
const clampMin = (m: number) => Math.max(WIN_START, Math.min(WIN_START + WIN_SPAN, m));
const pctH = (m: number) => ((clampMin(m) - WIN_START) / WIN_SPAN) * 100;
const RULER = [6, 9, 12, 15, 18, 21];

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

type GridProps = {
  days: Date[];
  occurrences: ResolvedOccurrence[];
  profileIds: string[];
  filter: AvailabilityFilter;
  nameById: Map<string, ProfileLite>;
  showOwners: boolean;
  orientation?: "vertical" | "horizontal";
  onSlotClick: (day: Date, hour: number) => void;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
};

function useGridOccs(occurrences: ResolvedOccurrence[], filter: AvailabilityFilter) {
  return useMemo(
    () =>
      occurrences.filter((o) => {
        if (filter === "available_only") return o.kind === "available";
        if (filter === "hide_unavailable") return o.kind !== "unavailable";
        return true;
      }),
    [occurrences, filter]
  );
}

export function TimeGridView(props: GridProps) {
  if (props.orientation === "horizontal") return <HorizontalGrid {...props} />;
  return <VerticalGrid {...props} />;
}

function VerticalGrid(props: GridProps) {
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
                  ? occ.title ?? occ.courseName ?? "Round"
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

// --- Horizontal (landscape) day-rows: time left→right, days stacked ----------

type PositionedH = { occ: ResolvedOccurrence; left: number; width: number; lane: number };

function packRowH(occs: ResolvedOccurrence[], day: Date): { items: PositionedH[]; lanes: number } {
  const dStart = startOfDay(day).getTime();
  const dEnd = endOfDay(day).getTime();
  const items = occs
    .map((occ) => {
      const s = Math.max(occ.start.getTime(), dStart);
      const e = Math.min(occ.end.getTime(), dEnd);
      const startMin = occ.allDay ? WIN_START : (s - dStart) / 60000;
      const endMin = occ.allDay ? WIN_START + WIN_SPAN : (e - dStart) / 60000;
      return { occ, startMin, endMin };
    })
    .filter((it) => it.endMin > it.startMin)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const laneEnds: number[] = [];
  const out: PositionedH[] = [];
  for (const it of items) {
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endMin);
    } else {
      laneEnds[lane] = it.endMin;
    }
    const left = pctH(it.startMin);
    out.push({ occ: it.occ, left, width: Math.max(6, pctH(it.endMin) - left), lane });
  }
  return { items: out, lanes: Math.max(1, laneEnds.length) };
}

function HorizontalGrid(props: GridProps) {
  const { days, occurrences, profileIds, filter, onSlotClick, onOccurrenceClick } = props;
  const gridOccs = useGridOccs(occurrences, filter);
  const showBusyShade = filter === "all";

  const rows = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return days.map((day) => {
      const ds = startOfDay(day).getTime();
      const de = endOfDay(day).getTime();
      const onDay = gridOccs.filter((o) => o.end.getTime() > ds && o.start.getTime() < de);
      const intervals =
        ds < today ? { busy: [], available: [] } : resolveDayIntervals(occurrences, profileIds, day);
      return { day, ...packRowH(onDay, day), intervals };
    });
  }, [days, gridOccs, occurrences, profileIds]);

  function trackClick(e: React.MouseEvent<HTMLButtonElement>, day: Date) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSlotClick(day, Math.round(WIN_START_H + frac * (WIN_END_H - WIN_START_H)));
  }

  return (
    <div className="rounded-2xl border border-emerald-900/60 bg-[#052a17]/40 p-2">
      {/* Ruler */}
      <div className="mb-1 flex items-center">
        <div style={{ width: H_LABEL_W }} className="shrink-0" />
        <div className="relative h-4 flex-1">
          {RULER.map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 text-[9px] text-emerald-200/45"
              style={{ left: `${pctH(h * 60)}%` }}
            >
              {formatHourLabel(h)}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {rows.map(({ day, items, lanes, intervals }) => (
          <div key={dayKey(day)} className="flex items-stretch gap-1">
            <div
              style={{ width: H_LABEL_W }}
              className="flex shrink-0 flex-col items-center justify-center"
            >
              <span className="text-[9px] uppercase tracking-wide text-emerald-200/50">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                  isToday(day) ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-50"
                )}
              >
                {day.getDate()}
              </span>
            </div>

            <button
              type="button"
              onClick={(e) => trackClick(e, day)}
              className={cn(
                "relative flex-1 overflow-hidden rounded-lg border border-emerald-900/40",
                isToday(day) ? "bg-emerald-900/20" : "bg-[#0b3b21]/25"
              )}
              style={{ height: lanes * LANE_H + 4 }}
              aria-label={`Add on ${day.toDateString()}`}
            >
              {RULER.map((h) => (
                <div
                  key={h}
                  className="pointer-events-none absolute inset-y-0 w-px bg-emerald-900/25"
                  style={{ left: `${pctH(h * 60)}%` }}
                />
              ))}
              {intervals.available.map((iv, i) => (
                <div
                  key={`a${i}`}
                  className="pointer-events-none absolute inset-y-0 bg-emerald-400/15"
                  style={{ left: `${pctH(iv.start)}%`, width: `${pctH(iv.end) - pctH(iv.start)}%` }}
                />
              ))}
              {showBusyShade
                ? intervals.busy.map((iv, i) => (
                    <div
                      key={`b${i}`}
                      className="pointer-events-none absolute inset-y-0 bg-slate-500/20"
                      style={{ left: `${pctH(iv.start)}%`, width: `${pctH(iv.end) - pctH(iv.start)}%` }}
                    />
                  ))
                : null}

              {items.map(({ occ, left, width, lane }) => {
                const isRound = occ.kind === "round";
                const players = isRound ? playersLabelH(occ.playerNames) : "";
                const primary = isRound
                  ? occ.title ?? occ.courseName ?? "Round"
                  : occ.title ?? (occ.kind === "available" ? "Available" : occ.kind === "event" ? "Event" : "Busy");
                return (
                  <button
                    key={occ.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOccurrenceClick(occ);
                    }}
                    className={cn(
                      "absolute flex items-center gap-1 overflow-hidden rounded px-1 text-left",
                      occChipClasses(occ)
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: lane * LANE_H + 2,
                      height: LANE_H - 3,
                    }}
                  >
                    <span className="min-w-0 truncate text-[10px] font-medium leading-none">
                      {primary}
                    </span>
                    {players ? (
                      <span className="min-w-0 truncate text-[9px] opacity-70 leading-none">
                        · {players}
                      </span>
                    ) : null}
                    {occ.resultLabel ? (
                      <span className="ml-auto shrink-0 text-[10px] font-bold tabular-nums">
                        {occ.resultLabel}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function playersLabelH(names: string[] | null | undefined): string {
  if (!names || names.length === 0) return "";
  const firsts = names.map((n) => n.split(" ")[0]);
  return firsts.length <= 2 ? firsts.join(", ") : `${firsts.slice(0, 2).join(", ")} +${firsts.length - 2}`;
}

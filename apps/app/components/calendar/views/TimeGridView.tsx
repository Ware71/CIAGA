"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AvailabilityFilter,
  Density,
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
import { applyAvailabilityFilter, resolveDayIntervals } from "@/lib/calendar/recurrence";
import {
  AVAILABLE_SHADE,
  BUSY_SHADE,
  UNUSABLE_SHADE,
  occChipClasses,
} from "../eventStyles";
import { EventChip } from "../EventChip";
import { RoundCard } from "../RoundCard";
import { InitialsAvatar, AvatarStack } from "../Avatar";

// Playable window: 6am–10pm, shared by both orientations.
const DAY_START_H = 6;
const DAY_END_H = 22;
const DAY_START_MIN = DAY_START_H * 60; // 360
const DAY_END_MIN = DAY_END_H * 60; // 1320
const VISIBLE_HOURS = DAY_END_H - DAY_START_H; // 16
const GUTTER = 40;
const MIN_BLOCK_PX = 18;

/** Fallback pixels per hour before the container is measured. */
const FALLBACK_HOUR_PX = 44;
/** Never shrink an hour row below this, even to fit (keeps blocks legible). */
const MIN_HOUR_PX = 26;

/** Measure a DOM element's content box, re-measuring on resize. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// Horizontal (landscape) day-row window uses the same 6am–10pm span.
const H_WIN_START = DAY_START_MIN;
const H_WIN_SPAN = DAY_END_MIN - DAY_START_MIN; // 960 min
const LANE_H = 22;
const H_LABEL_W = 44;
const clampMin = (m: number) => Math.max(H_WIN_START, Math.min(H_WIN_START + H_WIN_SPAN, m));
const pctH = (m: number) => ((clampMin(m) - H_WIN_START) / H_WIN_SPAN) * 100;
const RULER = [6, 9, 12, 15, 18, 21];

type Positioned = {
  occ: ResolvedOccurrence;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  early: boolean;
  late: boolean;
};

/** Greedy lane packing so overlapping blocks sit side by side within a column. */
function packDay(occs: ResolvedOccurrence[], day: Date, hourPx: number): Positioned[] {
  const dStart = startOfDay(day).getTime();
  const items = occs
    .map((occ) => {
      const sRaw = (occ.start.getTime() - dStart) / 60000;
      const eRaw = (occ.end.getTime() - dStart) / 60000;
      const startMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, sRaw));
      const endMin = Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, eRaw));
      return { occ, startMin, endMin, early: sRaw < DAY_START_MIN, late: eRaw > DAY_END_MIN };
    })
    // Keep rounds/events even if clamped to a sliver so off-hours ones stay visible.
    .filter((it) => it.endMin > it.startMin || it.occ.kind === "round" || it.occ.kind === "event")
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
  const gridH = VISIBLE_HOURS * hourPx;
  return items.map((it) => {
    const rawTop = ((it.startMin - DAY_START_MIN) / 60) * hourPx;
    const height = Math.max(MIN_BLOCK_PX, ((it.endMin - it.startMin) / 60) * hourPx);
    return {
      occ: it.occ,
      top: Math.min(rawTop, gridH - MIN_BLOCK_PX),
      height,
      lane: laneOf.get(it.occ) ?? 0,
      lanes,
      early: it.early,
      late: it.late,
    };
  });
}

type GridProps = {
  days: Date[];
  occurrences: ResolvedOccurrence[];
  profileIds: string[];
  filter: AvailabilityFilter;
  density: Density;
  /** When true, grey out free gaps < 3h as unusable (the 3-hour rule toggle). */
  markUnusable: boolean;
  nameById: Map<string, ProfileLite>;
  showOwners: boolean;
  orientation?: "vertical" | "horizontal";
  onSlotClick: (day: Date, hour: number) => void;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
};

/** Rounds & events always survive; both filters drop only unavailability blocks. */
function useGridOccs(occurrences: ResolvedOccurrence[], filter: AvailabilityFilter) {
  return useMemo(() => applyAvailabilityFilter(occurrences, filter), [occurrences, filter]);
}

export function TimeGridView(props: GridProps) {
  if (props.orientation === "horizontal") return <HorizontalGrid {...props} />;
  return <VerticalGrid {...props} />;
}

function EdgeMarker({ dir }: { dir: "up" | "down" }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute right-0.5 opacity-70",
        dir === "up" ? "top-0" : "bottom-0"
      )}
    >
      {dir === "up" ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
    </span>
  );
}

function VerticalGrid(props: GridProps) {
  const {
    days,
    occurrences,
    profileIds,
    filter,
    density,
    nameById,
    showOwners,
    onSlotClick,
    onOccurrenceClick,
  } = props;

  // Auto-fit: measure the body area and size hour rows to fill it (no scroll).
  const [bodyRef, bodySize] = useElementSize<HTMLDivElement>();
  const hourPx =
    bodySize.height > 0
      ? Math.max(MIN_HOUR_PX, bodySize.height / VISIBLE_HOURS)
      : FALLBACK_HOUR_PX;
  const colW =
    bodySize.width > 0 ? Math.max(80, (bodySize.width - GUTTER) / days.length) : 160;

  const hours = Array.from({ length: VISIBLE_HOURS }, (_, i) => DAY_START_H + i);
  const gridOccs = useGridOccs(occurrences, filter);
  const showUnusable = props.markUnusable;
  const isFull = density === "full";

  const perDay = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return days.map((day) => {
      const ds = startOfDay(day).getTime();
      const de = endOfDay(day).getTime();
      const onDay = gridOccs.filter((o) => o.end.getTime() > ds && o.start.getTime() < de);
      const allDay = onDay.filter((o) => o.allDay || (o.start.getTime() <= ds && o.end.getTime() >= de));
      const timed = onDay.filter((o) => !allDay.includes(o));
      const intervals =
        ds < today
          ? { busy: [], available: [], unusable: [] }
          : resolveDayIntervals(gridOccs, profileIds, day);
      return { day, allDay, positioned: packDay(timed, day, hourPx), intervals };
    });
  }, [days, gridOccs, profileIds, hourPx]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-emerald-900/60 bg-[#052a17]/40">
      {/* Day header + all-day chips (natural height) */}
      <div className="flex shrink-0 border-b border-emerald-900/60 bg-[#04240f]/95">
        <div className="shrink-0" style={{ width: GUTTER }} />
        {perDay.map(({ day, allDay }) => {
          const { weekday, day: dnum } = formatColumnHeader(day);
          return (
            <div
              key={dayKey(day)}
              className="min-w-0 flex-1 border-l border-emerald-900/40 px-1 py-1.5"
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

      {/* Body fills the remaining height; hour rows sized to fit (no scroll). */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="shrink-0" style={{ width: GUTTER }}>
          {hours.map((h) => (
            <div
              key={h}
              style={{ height: hourPx }}
              className="relative -top-1.5 pr-1 text-right text-[10px] text-emerald-200/45"
            >
              {formatHourLabel(h)}
            </div>
          ))}
        </div>

        {perDay.map(({ day, positioned, intervals }) => (
          <div
            key={dayKey(day)}
            className="relative min-w-0 flex-1 border-l border-emerald-900/40"
            style={{ height: VISIBLE_HOURS * hourPx }}
          >
            {/* hour rows / tap targets */}
            {hours.map((h) => (
              <button
                key={h}
                onClick={() => onSlotClick(day, h)}
                className="block w-full border-t border-emerald-900/20 hover:bg-emerald-500/5"
                style={{ height: hourPx }}
                aria-label={`Add at ${formatHourLabel(h)}`}
              />
            ))}

            {/* availability shading */}
            {intervals.available.map((iv, i) => (
              <div
                key={`a${i}`}
                className={cn("pointer-events-none absolute inset-x-0", AVAILABLE_SHADE)}
                style={shadeStyle(iv, hourPx)}
              />
            ))}
            {showUnusable
              ? intervals.unusable.map((iv, i) => (
                  <div
                    key={`u${i}`}
                    className={cn("pointer-events-none absolute inset-x-0", UNUSABLE_SHADE)}
                    style={shadeStyle(iv, hourPx)}
                  />
                ))
              : null}
            {intervals.busy.map((iv, i) => (
              <div
                key={`b${i}`}
                className={cn("pointer-events-none absolute inset-x-0", BUSY_SHADE)}
                style={shadeStyle(iv, hourPx)}
              />
            ))}

            {/* timed blocks */}
            {positioned.map(({ occ, top, height, lane, lanes, early, late }) => {
              const owner = showOwners ? nameById.get(occ.profileId) : undefined;
              const widthPct = 100 / lanes;
              const wPx = (colW * widthPct) / 100;
              const isRound = occ.kind === "round";
              const isEvent = occ.kind === "event";
              const richCard = isFull && (isRound || isEvent) && lanes <= 2;

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
                  {early ? <EdgeMarker dir="up" /> : null}
                  {late ? <EdgeMarker dir="down" /> : null}
                  {richCard ? (
                    <RoundCard occ={occ} owner={owner} tight={height < 44} />
                  ) : (
                    <VBlockContent occ={occ} owner={owner} wPx={wPx} height={height} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function shadeStyle(iv: { start: number; end: number }, hourPx: number): React.CSSProperties {
  const top = Math.max(0, ((iv.start - DAY_START_MIN) / 60) * hourPx);
  const bottom = ((Math.min(iv.end, DAY_END_MIN) - DAY_START_MIN) / 60) * hourPx;
  return { top, height: Math.max(0, bottom - top) };
}

/** The compact inline content for a timed block (week / 3-day, or overlapping day). */
function VBlockContent(props: {
  occ: ResolvedOccurrence;
  owner?: ProfileLite;
  wPx: number;
  height: number;
}) {
  const { occ, owner, wPx, height } = props;
  const isRound = occ.kind === "round";
  const players = isRound ? occ.playerNames ?? [] : [];
  const showName = !isRound || wPx >= 64;
  const primary = isRound
    ? occ.title ?? occ.courseName ?? "Round"
    : occ.title ?? (occ.kind === "available" ? "Available" : occ.kind === "event" ? "Event" : "Busy");
  const showSecondLine = height >= 34;
  const secondLine = occ.resultLabel
    ? `Gross ${occ.resultLabel}`
    : !occ.allDay
      ? formatTime(occ.start)
      : "";
  const inlineResult = occ.resultLabel && !showSecondLine;

  return (
    <>
      <div className="flex min-w-0 items-center gap-1">
        {isRound ? (
          players.length >= 2 ? (
            <AvatarStack people={players.map((n) => ({ seed: n, name: n }))} size={13} max={3} />
          ) : (
            <Flag size={11} className="shrink-0" />
          )
        ) : owner ? (
          <InitialsAvatar profileId={occ.profileId} name={owner.name} size={12} />
        ) : null}
        {showName ? (
          <span className="min-w-0 truncate text-[11px] font-medium leading-tight">{primary}</span>
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
    </>
  );
}

// --- Horizontal (landscape) day-rows: time left→right, days stacked ----------

type PositionedH = {
  occ: ResolvedOccurrence;
  left: number;
  width: number;
  lane: number;
  early: boolean;
  late: boolean;
};

function packRowH(occs: ResolvedOccurrence[], day: Date): { items: PositionedH[]; lanes: number } {
  const dStart = startOfDay(day).getTime();
  const dEnd = endOfDay(day).getTime();
  const items = occs
    .map((occ) => {
      const s = Math.max(occ.start.getTime(), dStart);
      const e = Math.min(occ.end.getTime(), dEnd);
      const sRaw = (s - dStart) / 60000;
      const eRaw = (e - dStart) / 60000;
      const startMin = occ.allDay ? H_WIN_START : clampMin(sRaw);
      const endMin = occ.allDay ? H_WIN_START + H_WIN_SPAN : clampMin(eRaw);
      return { occ, startMin, endMin, early: sRaw < H_WIN_START, late: eRaw > H_WIN_START + H_WIN_SPAN };
    })
    .filter((it) => it.endMin > it.startMin || it.occ.kind === "round" || it.occ.kind === "event")
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
    out.push({
      occ: it.occ,
      left,
      width: Math.max(6, pctH(it.endMin) - left),
      lane,
      early: it.early,
      late: it.late,
    });
  }
  return { items: out, lanes: Math.max(1, laneEnds.length) };
}

function HorizontalGrid(props: GridProps) {
  const { days, occurrences, profileIds, filter, onSlotClick, onOccurrenceClick } = props;
  const gridOccs = useGridOccs(occurrences, filter);
  const showUnusable = props.markUnusable;

  const rows = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return days.map((day) => {
      const ds = startOfDay(day).getTime();
      const de = endOfDay(day).getTime();
      const onDay = gridOccs.filter((o) => o.end.getTime() > ds && o.start.getTime() < de);
      const intervals =
        ds < today
          ? { busy: [], available: [], unusable: [] }
          : resolveDayIntervals(gridOccs, profileIds, day);
      return { day, ...packRowH(onDay, day), intervals };
    });
  }, [days, gridOccs, profileIds]);

  function trackClick(e: React.MouseEvent<HTMLButtonElement>, day: Date) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSlotClick(day, Math.round(DAY_START_H + frac * (DAY_END_H - DAY_START_H)));
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
                  className={cn("pointer-events-none absolute inset-y-0", AVAILABLE_SHADE)}
                  style={{ left: `${pctH(iv.start)}%`, width: `${pctH(iv.end) - pctH(iv.start)}%` }}
                />
              ))}
              {showUnusable
                ? intervals.unusable.map((iv, i) => (
                    <div
                      key={`u${i}`}
                      className={cn("pointer-events-none absolute inset-y-0", UNUSABLE_SHADE)}
                      style={{ left: `${pctH(iv.start)}%`, width: `${pctH(iv.end) - pctH(iv.start)}%` }}
                    />
                  ))
                : null}
              {intervals.busy.map((iv, i) => (
                <div
                  key={`b${i}`}
                  className={cn("pointer-events-none absolute inset-y-0", BUSY_SHADE)}
                  style={{ left: `${pctH(iv.start)}%`, width: `${pctH(iv.end) - pctH(iv.start)}%` }}
                />
              ))}

              {items.map(({ occ, left, width, lane, early, late }) => {
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
                    {early ? <span className="shrink-0 opacity-70">‹</span> : null}
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
                    {late ? <span className="shrink-0 opacity-70">›</span> : null}
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

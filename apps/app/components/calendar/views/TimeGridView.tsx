"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type {
  AvailabilityFilter,
  ProfileLite,
  ResolvedOccurrence,
} from "@/lib/calendar/types";
import { endOfDay, dayKey, isToday, startOfDay } from "@/lib/calendar/dateUtils";
import { resolveDayIntervals } from "@/lib/calendar/recurrence";
import { occChipClasses } from "../eventStyles";

const WIN_START_H = 6;
const WIN_END_H = 23;
const WIN_START = WIN_START_H * 60;
const WIN_SPAN = (WIN_END_H - WIN_START_H) * 60; // minutes
const LANE_PX = 26;
const LABEL_W = 46;

const clampMin = (m: number) => Math.max(WIN_START, Math.min(WIN_START + WIN_SPAN, m));
const pct = (m: number) => ((clampMin(m) - WIN_START) / WIN_SPAN) * 100;

type Positioned = { occ: ResolvedOccurrence; left: number; width: number; lane: number };

/** Lane-pack a day's occurrences (by clock time) into non-overlapping rows. */
function packRow(occs: ResolvedOccurrence[], day: Date): { items: Positioned[]; lanes: number } {
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
  const out: Positioned[] = [];
  for (const it of items) {
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endMin);
    } else {
      laneEnds[lane] = it.endMin;
    }
    const left = pct(it.startMin);
    const width = Math.max(7, pct(it.endMin) - left);
    out.push({ occ: it.occ, left, width, lane });
  }
  return { items: out, lanes: Math.max(1, laneEnds.length) };
}

/** First names of players for a round bar, e.g. "Ware, Jack +2". */
function playersLabel(names: string[] | null | undefined): string {
  if (!names || names.length === 0) return "";
  const firsts = names.map((n) => n.split(" ")[0]);
  if (firsts.length <= 2) return firsts.join(", ");
  return `${firsts.slice(0, 2).join(", ")} +${firsts.length - 2}`;
}

const RULER = [6, 9, 12, 15, 18, 21];
function rulerLabel(h: number) {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
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

  const gridOccs = useMemo(
    () =>
      occurrences.filter((o) => {
        if (filter === "available_only") return o.kind === "available";
        if (filter === "hide_unavailable") return !o.busy;
        return true;
      }),
    [occurrences, filter]
  );

  const rows = useMemo(() => {
    const today = startOfDay(new Date()).getTime();
    return days.map((day) => {
      const ds = startOfDay(day).getTime();
      const de = endOfDay(day).getTime();
      const onDay = gridOccs.filter((o) => o.end.getTime() > ds && o.start.getTime() < de);
      const packed = packRow(onDay, day);
      const isPast = ds < today;
      const intervals = isPast
        ? { busy: [], available: [] }
        : resolveDayIntervals(occurrences, profileIds, day);
      return { day, ...packed, intervals };
    });
  }, [days, gridOccs, occurrences, profileIds]);

  const showBusyShade = filter === "all";

  function handleTrackClick(e: React.MouseEvent<HTMLButtonElement>, day: Date) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const hour = Math.round(WIN_START_H + frac * (WIN_END_H - WIN_START_H));
    onSlotClick(day, hour);
  }

  return (
    <div className="rounded-2xl border border-emerald-900/60 bg-[#052a17]/40 p-2">
      {/* Ruler */}
      <div className="mb-1 flex items-center">
        <div style={{ width: LABEL_W }} className="shrink-0" />
        <div className="relative h-4 flex-1">
          {RULER.map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 text-[9px] text-emerald-200/45"
              style={{ left: `${pct(h * 60)}%` }}
            >
              {rulerLabel(h)}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        {rows.map(({ day, items, lanes, intervals }) => {
          const rowH = lanes * LANE_PX + 6;
          const today = isToday(day);
          return (
            <div key={dayKey(day)} className="flex items-stretch gap-1">
              {/* Day label */}
              <div
                style={{ width: LABEL_W }}
                className="flex shrink-0 flex-col items-center justify-center"
              >
                <span className="text-[9px] uppercase tracking-wide text-emerald-200/50">
                  {day.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                    today ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-50"
                  )}
                >
                  {day.getDate()}
                </span>
              </div>

              {/* Track */}
              <button
                type="button"
                onClick={(e) => handleTrackClick(e, day)}
                className={cn(
                  "relative flex-1 overflow-hidden rounded-lg border border-emerald-900/40",
                  today ? "bg-emerald-900/20" : "bg-[#0b3b21]/25"
                )}
                style={{ height: rowH }}
                aria-label={`Add on ${day.toDateString()}`}
              >
                {/* vertical gridlines every 3h */}
                {RULER.map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-y-0 w-px bg-emerald-900/25"
                    style={{ left: `${pct(h * 60)}%` }}
                  />
                ))}

                {/* availability shading */}
                {intervals.available.map((iv, i) => (
                  <div
                    key={`a${i}`}
                    className="pointer-events-none absolute inset-y-0 bg-emerald-400/15"
                    style={{ left: `${pct(iv.start)}%`, width: `${pct(iv.end) - pct(iv.start)}%` }}
                  />
                ))}
                {showBusyShade
                  ? intervals.busy.map((iv, i) => (
                      <div
                        key={`b${i}`}
                        className="pointer-events-none absolute inset-y-0 bg-slate-500/20"
                        style={{ left: `${pct(iv.start)}%`, width: `${pct(iv.end) - pct(iv.start)}%` }}
                      />
                    ))
                  : null}

                {/* blocks */}
                {items.map(({ occ, left, width, lane }) => {
                  const owner = showOwners ? nameById.get(occ.profileId) : undefined;
                  const isRound = occ.kind === "round";
                  const primary = isRound
                    ? occ.courseName ?? occ.title ?? "Round"
                    : occ.title ?? (occ.kind === "available" ? "Available" : "Busy");
                  const players = isRound ? playersLabel(occ.playerNames) : owner?.name?.split(" ")[0];
                  return (
                    <button
                      key={occ.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOccurrenceClick(occ);
                      }}
                      className={cn(
                        "absolute flex items-center gap-1 overflow-hidden rounded-md px-1.5 text-left shadow-sm shadow-black/20",
                        occChipClasses(occ),
                        occ.recurring && "border-dashed"
                      )}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        top: lane * LANE_PX + 3,
                        height: LANE_PX - 4,
                      }}
                    >
                      <span className="truncate text-[10px] font-medium leading-none">{primary}</span>
                      {players ? (
                        <span className="truncate text-[9px] opacity-70 leading-none">· {players}</span>
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
          );
        })}
      </div>
    </div>
  );
}

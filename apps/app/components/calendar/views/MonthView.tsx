"use client";

import { cn } from "@/lib/utils";
import type { AvailabilityFilter, BucketState, ResolvedOccurrence } from "@/lib/calendar/types";
import {
  dayKey,
  getMonthMatrix,
  isSameMonth,
  isToday,
} from "@/lib/calendar/dateUtils";
import { isDayVisible } from "@/lib/calendar/recurrence";
import { EventChip } from "../EventChip";

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView(props: {
  anchor: Date;
  occurrencesByDay: Map<string, ResolvedOccurrence[]>;
  dayStates: Map<string, BucketState>;
  filter: AvailabilityFilter;
  showOwnerDots: boolean;
  onDayClick: (day: Date) => void;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
}) {
  const { anchor, occurrencesByDay, dayStates, filter, showOwnerDots, onDayClick, onOccurrenceClick } =
    props;
  const matrix = getMonthMatrix(anchor);

  return (
    <div className="select-none">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_HEADERS.map((h) => (
          <div key={h} className="text-center text-[10px] uppercase tracking-wide text-emerald-200/50">
            {h}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {matrix.flat().map((day) => {
          const key = dayKey(day);
          const visible = isDayVisible(day, dayStates, filter);
          const inMonth = isSameMonth(day, anchor);
          const state = dayStates.get(key) ?? "neutral";
          const occs = visible ? occurrencesByDay.get(key) ?? [] : [];
          const shown = occs.slice(0, 3);
          const extra = occs.length - shown.length;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick(day)}
              className={cn(
                "min-h-[64px] rounded-lg border p-1 text-left align-top transition-colors",
                inMonth ? "bg-[#0b3b21]/40" : "bg-[#0b3b21]/15",
                state === "available" && visible
                  ? "border-emerald-400/40"
                  : "border-emerald-900/50",
                !visible && "opacity-30",
                "hover:bg-emerald-900/30"
              )}
            >
              <div
                className={cn(
                  "mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                  isToday(day)
                    ? "bg-[#f5e6b0] font-bold text-[#042713]"
                    : inMonth
                      ? "text-emerald-100/80"
                      : "text-emerald-100/40"
                )}
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {shown.map((occ) => (
                  <EventChip
                    key={occ.key}
                    occ={occ}
                    compact
                    showOwnerDot={showOwnerDots}
                    onClick={onOccurrenceClick}
                  />
                ))}
                {extra > 0 ? (
                  <div className="px-1 text-[9px] text-emerald-200/60">+{extra} more</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

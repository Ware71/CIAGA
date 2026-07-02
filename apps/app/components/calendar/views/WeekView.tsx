"use client";

import { cn } from "@/lib/utils";
import type { AvailabilityFilter, BucketState, ResolvedOccurrence } from "@/lib/calendar/types";
import { dayKey, getWeekDays, isToday, formatDayLabel } from "@/lib/calendar/dateUtils";
import { isDayVisible } from "@/lib/calendar/recurrence";
import { EventChip } from "../EventChip";

/** A week (or weekends) shown as a vertical list of day cards. */
export function WeekView(props: {
  days: Date[];
  occurrencesByDay: Map<string, ResolvedOccurrence[]>;
  dayStates: Map<string, BucketState>;
  filter: AvailabilityFilter;
  showOwnerDots: boolean;
  onDayClick: (day: Date) => void;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
}) {
  const { days, occurrencesByDay, dayStates, filter, showOwnerDots, onDayClick, onOccurrenceClick } =
    props;

  return (
    <div className="space-y-2">
      {days.map((day) => {
        const key = dayKey(day);
        const visible = isDayVisible(day, dayStates, filter);
        if (!visible) return null;
        const state = dayStates.get(key) ?? "neutral";
        const occs = occurrencesByDay.get(key) ?? [];

        return (
          <button
            key={key}
            type="button"
            onClick={() => onDayClick(day)}
            className={cn(
              "block w-full rounded-xl border p-2.5 text-left transition-colors hover:bg-emerald-900/25",
              state === "available"
                ? "border-emerald-400/40 bg-emerald-900/15"
                : "border-emerald-900/60 bg-[#0b3b21]/40"
            )}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span
                className={cn(
                  "text-xs font-semibold",
                  isToday(day) ? "text-[#f5e6b0]" : "text-emerald-50"
                )}
              >
                {formatDayLabel(day)}
              </span>
              {state === "available" ? (
                <span className="text-[9px] uppercase tracking-wide text-emerald-300/70">Free</span>
              ) : null}
            </div>
            {occs.length === 0 ? (
              <div className="text-[10px] text-emerald-100/40">Tap to add</div>
            ) : (
              <div className="space-y-0.5">
                {occs.map((occ) => (
                  <EventChip
                    key={occ.key}
                    occ={occ}
                    showOwnerDot={showOwnerDots}
                    onClick={onOccurrenceClick}
                  />
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function useWeekDays(anchor: Date): Date[] {
  return getWeekDays(anchor);
}

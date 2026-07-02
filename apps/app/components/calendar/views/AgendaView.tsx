"use client";

import { cn } from "@/lib/utils";
import type { AvailabilityFilter, BucketState, ResolvedOccurrence } from "@/lib/calendar/types";
import { dayKey, formatDayLabel, isToday } from "@/lib/calendar/dateUtils";
import { isDayVisible } from "@/lib/calendar/recurrence";
import { EventChip } from "../EventChip";

/** Agenda: only days that have something to show (empty days removed). */
export function AgendaView(props: {
  days: Date[];
  occurrencesByDay: Map<string, ResolvedOccurrence[]>;
  dayStates: Map<string, BucketState>;
  filter: AvailabilityFilter;
  showOwnerDots: boolean;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
}) {
  const { days, occurrencesByDay, dayStates, filter, showOwnerDots, onOccurrenceClick } = props;

  const rows = days
    .map((day) => {
      const key = dayKey(day);
      const visible = isDayVisible(day, dayStates, filter);
      const occs = visible ? occurrencesByDay.get(key) ?? [] : [];
      return { day, key, occs };
    })
    .filter((r) => r.occs.length > 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 p-6 text-center text-sm text-emerald-100/60">
        Nothing scheduled in this range.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map(({ day, key, occs }) => (
        <div key={key} className="flex gap-3">
          <div className="w-14 shrink-0 pt-0.5">
            <div
              className={cn(
                "text-[11px] font-semibold",
                isToday(day) ? "text-[#f5e6b0]" : "text-emerald-100/80"
              )}
            >
              {formatDayLabel(day)}
            </div>
          </div>
          <div className="flex-1 space-y-1">
            {occs.map((occ) => (
              <EventChip
                key={occ.key}
                occ={occ}
                showOwnerDot={showOwnerDots}
                onClick={onOccurrenceClick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

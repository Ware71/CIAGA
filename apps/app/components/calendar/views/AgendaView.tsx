"use client";

import { cn } from "@/lib/utils";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import { dayKey, formatDayLabel, isToday } from "@/lib/calendar/dateUtils";
import { EventChip } from "../EventChip";

/** Agenda: everything upcoming, grouped by day (empty days removed, no filter). */
export function AgendaView(props: {
  days: Date[];
  occurrencesByDay: Map<string, ResolvedOccurrence[]>;
  showOwners: boolean;
  nameById: Map<string, ProfileLite>;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
}) {
  const { days, occurrencesByDay, showOwners, nameById, onOccurrenceClick } = props;

  const rows = days
    .map((day) => ({ day, key: dayKey(day), occs: occurrencesByDay.get(dayKey(day)) ?? [] }))
    .filter((r) => r.occs.length > 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 p-6 text-center text-sm text-emerald-100/60">
        Nothing coming up.
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
                owner={showOwners ? nameById.get(occ.profileId) : undefined}
                onClick={onOccurrenceClick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

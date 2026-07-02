"use client";

import { Search } from "lucide-react";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import { dayKey, formatDayLabel, formatTime, isToday } from "@/lib/calendar/dateUtils";
import { cn } from "@/lib/utils";
import { InitialsAvatar } from "../Avatar";

/** An agenda of Availability events from people you follow + circle members. */
export function LookingForRoundView(props: {
  days: Date[];
  occurrencesByDay: Map<string, ResolvedOccurrence[]>;
  nameById: Map<string, ProfileLite>;
  onOpenPerson: (profileId: string) => void;
}) {
  const { days, occurrencesByDay, nameById, onOpenPerson } = props;

  const rows = days
    .map((day) => ({ day, occs: occurrencesByDay.get(dayKey(day)) ?? [] }))
    .filter((r) => r.occs.length > 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 p-8 text-center">
        <Search className="mx-auto mb-2 text-emerald-300/50" size={22} />
        <div className="text-sm font-semibold text-emerald-50">Nobody's looking yet</div>
        <p className="mt-1 text-[11px] text-emerald-100/60 leading-relaxed">
          When people you follow or your circle members mark themselves available, they'll show up
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map(({ day, occs }) => (
        <div key={dayKey(day)}>
          <div
            className={cn(
              "mb-1.5 text-[11px] font-semibold uppercase tracking-wide",
              isToday(day) ? "text-[#f5e6b0]" : "text-emerald-200/60"
            )}
          >
            {formatDayLabel(day)}
          </div>
          <div className="space-y-1.5">
            {occs.map((occ) => {
              const p = nameById.get(occ.profileId);
              return (
                <button
                  key={occ.key}
                  onClick={() => onOpenPerson(occ.profileId)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/50 px-3 py-2.5 text-left transition-colors hover:bg-emerald-900/25"
                >
                  <InitialsAvatar profileId={occ.profileId} name={p?.name ?? null} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-emerald-50">
                      {p?.name ?? "Player"}
                    </div>
                    <div className="text-[11px] text-emerald-100/60">
                      {occ.allDay
                        ? "Available all day"
                        : `Free ${formatTime(occ.start)}–${formatTime(occ.end)}`}
                      {occ.title ? ` · ${occ.title}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-300">
                    View
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

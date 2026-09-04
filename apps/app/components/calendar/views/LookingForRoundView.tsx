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
      <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] p-8 text-center">
        <Search className="mx-auto mb-2 text-[color:var(--sec-muted)]" size={22} />
        <div className="text-sm font-semibold text-[color:var(--sec-text)]">Nobody's looking yet</div>
        <p className="mt-1 text-[11px] text-[color:var(--sec-muted)] leading-relaxed">
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
              isToday(day) ? "text-[color:var(--sec-accent)]" : "text-[color:var(--sec-muted)]"
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
                  className="flex w-full items-center gap-2.5 rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_50%,transparent)] px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--sec-surface-2)]"
                >
                  <InitialsAvatar profileId={occ.profileId} name={p?.name ?? null} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[color:var(--sec-text)]">
                      {p?.name ?? "Player"}
                    </div>
                    <div className="text-[11px] text-[color:var(--sec-muted)]">
                      {occ.allDay
                        ? "Available all day"
                        : `Free ${formatTime(occ.start)}–${formatTime(occ.end)}`}
                      {occ.title ? ` · ${occ.title}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-[color:var(--sec-good)]">
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

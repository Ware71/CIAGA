"use client";

import { cn } from "@/lib/utils";
import type { ProfileLite, ResolvedOccurrence } from "@/lib/calendar/types";
import {
  dayKey,
  endOfDay,
  getMonthMatrix,
  isSameMonth,
  isToday,
  startOfDay,
} from "@/lib/calendar/dateUtils";
import { dayHeat, resolveDayPlayerStatuses } from "@/lib/calendar/recurrence";
import { STATUS_COLORS } from "../eventStyles";
import { formatDiff } from "../EventChip";
import { AvatarStack } from "../Avatar";

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_DOTS = 6;

function heatStyle(heat: number): React.CSSProperties {
  if (heat > 0.01) return { backgroundColor: `rgba(52,211,153,${(0.06 + heat * 0.2).toFixed(3)})` };
  if (heat < -0.01) return { backgroundColor: `rgba(239,68,68,${(0.06 - heat * 0.2).toFixed(3)})` };
  return {};
}

export function MonthView(props: {
  anchor: Date;
  /** Unfiltered occurrences for the displayed people (past availability already dropped). */
  occurrences: ResolvedOccurrence[];
  profileIds: string[];
  nameById: Map<string, ProfileLite>;
  onDayClick: (day: Date) => void;
  onOpenRound: (occ: ResolvedOccurrence) => void;
}) {
  const { anchor, occurrences, profileIds, onDayClick, onOpenRound } = props;
  const matrix = getMonthMatrix(anchor);
  const todayStart = startOfDay(new Date()).getTime();
  const singleView = profileIds.length <= 1;

  return (
    <div className="select-none">
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAY_HEADERS.map((h) => (
          <div key={h} className="text-center text-[10px] uppercase tracking-wide text-emerald-200/50">
            {h}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {matrix.flat().map((day) => {
          const key = dayKey(day);
          const inMonth = isSameMonth(day, anchor);
          const ds = startOfDay(day).getTime();
          const de = endOfDay(day).getTime();
          const isPast = ds < todayStart;

          // Past: finished-round result rows. Future/today: heat + player dots.
          const rounds = isPast
            ? occurrences.filter(
                (o) => o.kind === "round" && o.end.getTime() > ds && o.start.getTime() < de
              )
            : [];
          const statuses = isPast ? null : resolveDayPlayerStatuses(occurrences, profileIds, day);
          const cellStyle = statuses ? heatStyle(dayHeat(statuses)) : undefined;

          const dots = statuses ? profileIds.map((id) => statuses.get(id) ?? "none") : [];
          const shownDots = dots.slice(0, MAX_DOTS);
          const extraDots = dots.length - shownDots.length;
          const shownRounds = rounds.slice(0, 2);
          const extraRounds = rounds.length - shownRounds.length;

          return (
            <button
              key={key}
              type="button"
              onClick={() => (isPast ? undefined : onDayClick(day))}
              style={cellStyle}
              className={cn(
                "flex min-h-[72px] flex-col overflow-hidden rounded-lg border p-1 text-left transition-colors landscape:min-h-[92px]",
                inMonth ? "border-emerald-900/50" : "border-emerald-900/40 bg-[#0b3b21]/10",
                isToday(day) && "ring-1 ring-[#f5e6b0]/60",
                !isPast && "hover:bg-emerald-900/20"
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

              {isPast ? (
                <div className="flex min-h-0 flex-1 flex-col gap-0.5">
                  {shownRounds.map((occ) => {
                    const showScore = singleView || occ.selfParticipated;
                    const one = shownRounds.length === 1;
                    const diffText = formatDiff(occ.scoreDiff);
                    return (
                      <button
                        key={occ.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenRound(occ);
                        }}
                        className="flex min-h-0 flex-1 items-center justify-center rounded bg-[#f5e6b0]/10"
                      >
                        {showScore && occ.resultLabel ? (
                          <span className="flex items-baseline gap-0.5 text-[#f5e6b0]">
                            <span className={cn("font-bold tabular-nums", one ? "text-lg" : "text-xs")}>
                              {occ.resultLabel}
                            </span>
                            {diffText ? (
                              <span className={one ? "text-[10px] opacity-70" : "text-[8px] opacity-70"}>
                                {diffText}
                              </span>
                            ) : null}
                          </span>
                        ) : (occ.playerNames?.length ?? 0) > 0 ? (
                          <AvatarStack
                            people={(occ.playerNames ?? []).map((n) => ({ seed: n, name: n }))}
                            size={one ? 22 : 16}
                            max={3}
                          />
                        ) : (
                          <span className="text-[9px] text-emerald-200/60">Round</span>
                        )}
                      </button>
                    );
                  })}
                  {extraRounds > 0 ? (
                    <div className="text-center text-[8px] text-emerald-200/60">+{extraRounds}</div>
                  ) : null}
                </div>
              ) : dots.length > 0 ? (
                <div className="mt-auto flex flex-wrap gap-0.5">
                  {shownDots.map((s, i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[s] }}
                    />
                  ))}
                  {extraDots > 0 ? (
                    <span className="text-[8px] leading-none text-emerald-200/60">+{extraDots}</span>
                  ) : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

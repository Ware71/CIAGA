"use client";

import type {
  AvailabilityFilter,
  Density,
  ProfileLite,
  ResolvedOccurrence,
  ZoomLevel,
} from "@/lib/calendar/types";
import { isSameMonth, weekColumns } from "@/lib/calendar/dateUtils";
import { DayCell } from "./DayCell";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Short column header for a week, from its Monday, e.g. "6 Jul". */
function weekLabel(monday: Date): string {
  return monday.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The transposed main calendar grid: 7 weekday **rows** (Mon→Sun) on the Y axis
 * and weeks as **columns** on the X axis (Month ≈ 5 cols; 4/3/2/1-week zooms
 * fewer). Fills its parent's fixed height via CSS `1fr` rows/cols — no scroll.
 */
export function WeekGridView(props: {
  anchor: Date;
  zoom: ZoomLevel;
  occurrences: ResolvedOccurrence[];
  profileIds: string[];
  filter: AvailabilityFilter;
  applyThreeHour: boolean;
  density: Density;
  nameById: Map<string, ProfileLite>;
  showOwners: boolean;
  onOccurrenceClick: (occ: ResolvedOccurrence) => void;
  onEmptyDayClick: (day: Date) => void;
}) {
  const { anchor, zoom } = props;
  const weeks = weekColumns(anchor, zoom);
  const n = weeks.length;

  const cell = {
    occurrences: props.occurrences,
    profileIds: props.profileIds,
    filter: props.filter,
    applyThreeHour: props.applyThreeHour,
    density: props.density,
    nameById: props.nameById,
    showOwners: props.showOwners,
    onOccurrenceClick: props.onOccurrenceClick,
    onEmptyClick: props.onEmptyDayClick,
  };

  return (
    <div
      className="grid h-full min-h-0 select-none gap-1"
      style={{
        gridTemplateColumns: `2.1rem repeat(${n}, minmax(0, 1fr))`,
        gridTemplateRows: `auto repeat(7, minmax(0, 1fr))`,
      }}
    >
      {/* Header row: empty corner + one label per week column */}
      <div />
      {weeks.map((week, c) => (
        <div
          key={`h${c}`}
          className="truncate text-center text-[9px] uppercase tracking-wide text-emerald-200/50"
        >
          {weekLabel(week[0])}
        </div>
      ))}

      {/* One row per weekday: left label + a DayCell for each week */}
      {WEEKDAYS.map((wd, r) => (
        <FragmentRow key={wd}>
          <div className="flex items-center justify-end pr-0.5 text-[9px] uppercase tracking-wide text-emerald-200/50">
            {wd}
          </div>
          {weeks.map((week, c) => {
            const day = week[r];
            return (
              <DayCell
                key={`${c}-${r}`}
                day={day}
                inScope={zoom === 0 ? isSameMonth(day, anchor) : true}
                {...cell}
              />
            );
          })}
        </FragmentRow>
      ))}
    </div>
  );
}

/** Grid children must be flat, so a "row" is just a fragment of its cells. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

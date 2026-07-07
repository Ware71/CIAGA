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

/** Short row header for a week, from its Monday, e.g. "6 Jul". */
function weekLabel(monday: Date): string {
  return monday.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The Weekends view: weeks as **rows** on the Y axis, Sat & Sun as the two
 * **columns** on the X axis. Same zoom ladder as the main grid up to 1 week
 * (no time-grid levels). Fills its parent's fixed height — no scroll.
 */
export function WeekendsGridView(props: {
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
        gridTemplateColumns: "2.6rem 1fr 1fr",
        gridTemplateRows: `auto repeat(${weeks.length}, minmax(0, 1fr))`,
      }}
    >
      {/* Header row */}
      <div />
      <div className="text-center text-[9px] uppercase tracking-wide text-emerald-200/50">Sat</div>
      <div className="text-center text-[9px] uppercase tracking-wide text-emerald-200/50">Sun</div>

      {/* One row per week: label + Sat + Sun */}
      {weeks.map((week, i) => {
        const sat = week[5];
        const sun = week[6];
        return (
          <FragmentRow key={i}>
            <div className="flex items-center justify-end pr-0.5 text-[9px] uppercase tracking-wide text-emerald-200/50">
              {weekLabel(week[0])}
            </div>
            <DayCell
              day={sat}
              inScope={zoom === 0 ? isSameMonth(sat, anchor) : true}
              {...cell}
            />
            <DayCell
              day={sun}
              inScope={zoom === 0 ? isSameMonth(sun, anchor) : true}
              {...cell}
            />
          </FragmentRow>
        );
      })}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

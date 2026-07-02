"use client";

import { useMemo } from "react";
import { RRule, Weekday } from "rrule";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "./SegmentedControl";

type Freq = "none" | "daily" | "weekly" | "monthly";

export type RecurrenceValue = {
  freq: Freq;
  interval: number;
  /** 0=Mon .. 6=Sun (RRule weekday indices) */
  weekdays: number[];
  until: string | null; // YYYY-MM-DD
};

export const EMPTY_RECURRENCE: RecurrenceValue = {
  freq: "none",
  interval: 1,
  weekdays: [],
  until: null,
};

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const RRULE_WEEKDAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];

/** Build an iCal RRULE string from the editor value (null when non-recurring). */
export function buildRRule(value: RecurrenceValue): string | null {
  if (value.freq === "none") return null;
  const opts: Partial<ConstructorParameters<typeof RRule>[0]> = {
    interval: Math.max(1, value.interval),
  };
  if (value.freq === "daily") opts.freq = RRule.DAILY;
  if (value.freq === "monthly") opts.freq = RRule.MONTHLY;
  if (value.freq === "weekly") {
    opts.freq = RRule.WEEKLY;
    if (value.weekdays.length > 0) {
      opts.byweekday = value.weekdays.map((d) => RRULE_WEEKDAYS[d]) as Weekday[];
    }
  }
  if (value.until) {
    const d = new Date(`${value.until}T23:59:59`);
    opts.until = d;
  }
  const rule = new RRule(opts as any);
  return rule.toString().replace(/^RRULE:/, "");
}

export function RecurrenceEditor(props: {
  value: RecurrenceValue;
  onChange: (v: RecurrenceValue) => void;
}) {
  const { value, onChange } = props;

  const summary = useMemo(() => {
    if (value.freq === "none") return "Does not repeat";
    try {
      const rr = buildRRule(value);
      if (!rr) return "Does not repeat";
      return new RRule(RRule.parseString(rr)).toText();
    } catch {
      return "Repeats";
    }
  }, [value]);

  function toggleWeekday(d: number) {
    const has = value.weekdays.includes(d);
    onChange({
      ...value,
      weekdays: has ? value.weekdays.filter((x) => x !== d) : [...value.weekdays, d].sort(),
    });
  }

  return (
    <div className="space-y-3">
      <SegmentedControl<Freq>
        size="sm"
        value={value.freq}
        onChange={(freq) => onChange({ ...value, freq })}
        options={[
          { value: "none", label: "Once" },
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ]}
      />

      {value.freq === "weekly" ? (
        <div className="flex gap-1">
          {WEEKDAY_LABELS.map((lbl, i) => {
            const active = value.weekdays.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleWeekday(i)}
                className={cn(
                  "h-8 w-8 rounded-full text-[11px] font-semibold transition-colors",
                  active
                    ? "bg-[#f5e6b0] text-[#042713]"
                    : "border border-emerald-900/70 text-emerald-100/70 hover:bg-emerald-900/30"
                )}
              >
                {lbl}
              </button>
            );
          })}
        </div>
      ) : null}

      {value.freq !== "none" ? (
        <div className="flex items-center gap-2 text-xs text-emerald-100/80">
          <span>Every</span>
          <input
            type="number"
            min={1}
            value={value.interval}
            onChange={(e) => onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })}
            className="w-14 rounded-md border border-emerald-900/70 bg-[#042713] px-2 py-1 text-emerald-50"
          />
          <span>
            {value.freq === "daily" ? "day(s)" : value.freq === "weekly" ? "week(s)" : "month(s)"}
          </span>
        </div>
      ) : null}

      {value.freq !== "none" ? (
        <label className="flex items-center gap-2 text-xs text-emerald-100/80">
          <span className="shrink-0">Until</span>
          <input
            type="date"
            value={value.until ?? ""}
            onChange={(e) => onChange({ ...value, until: e.target.value || null })}
            className="rounded-md border border-emerald-900/70 bg-[#042713] px-2 py-1 text-emerald-50"
          />
          {value.until ? (
            <button
              type="button"
              className="text-emerald-300/70 underline"
              onClick={() => onChange({ ...value, until: null })}
            >
              clear
            </button>
          ) : null}
        </label>
      ) : null}

      <div className="text-[11px] italic text-emerald-200/60 capitalize">{summary}</div>
    </div>
  );
}

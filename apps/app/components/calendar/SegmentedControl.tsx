"use client";

import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = { value: T; label: string };

/** A pill segmented control matching the app's emerald theme. Segments are
 * equal-width so multiple rows line up regardless of option count. */
export function SegmentedControl<T extends string>(props: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const { options, value, onChange, size = "md", className } = props;
  return (
    <div
      className={cn(
        "flex w-full items-center gap-1 rounded-full border border-emerald-900/60 bg-[#0b3b21]/50 p-1 shadow-inner shadow-black/20",
        className
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 rounded-full text-center font-medium transition-all whitespace-nowrap",
              size === "sm" ? "px-1.5 py-1 text-[11px]" : "px-2 py-1.5 text-xs",
              active
                ? "bg-[#f5e6b0] text-[#042713] shadow-sm shadow-black/30"
                : "text-emerald-100/70 hover:text-emerald-50 hover:bg-emerald-900/30"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

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
        "flex w-full items-center gap-1 rounded-full border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_50%,transparent)] p-1 shadow-inner shadow-black/20",
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
                ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] shadow-sm shadow-black/30"
                : "text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

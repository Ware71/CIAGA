"use client";

import { useEffect, useRef } from "react";

export function LabelWheel({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    const item = el.querySelectorAll<HTMLElement>("[data-wheel-item]")[idx];
    if (item) item.scrollIntoView({ block: "center", behavior: "instant" as any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll selected value into view when value changes externally
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    const item = el.querySelectorAll<HTMLElement>("[data-wheel-item]")[idx];
    if (item) item.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [value, options]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;

    let best: { v: string; dist: number } | null = null;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-wheel-item]"));
    for (const it of items) {
      const r = it.getBoundingClientRect();
      const c = r.top + r.height / 2;
      const dist = Math.abs(c - mid);
      const v = it.dataset.value ?? "";
      if (!best || dist < best.dist) best = { v, dist };
    }
    if (best && best.v !== value) onChange(best.v);
  };

  return (
    <div className="relative rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
      <div className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 h-10 border-y border-[#f5e6b0]/35 bg-[#f5e6b0]/10" />
      <div
        ref={ref}
        onScroll={onScroll}
        className="h-40 overflow-y-auto scroll-smooth snap-y snap-mandatory"
        style={{ paddingTop: 60, paddingBottom: 60, WebkitOverflowScrolling: "touch" }}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <div key={opt.value} data-wheel-item data-value={opt.value} className="h-10 snap-center flex items-center justify-center px-2">
              <div
                className={
                  active
                    ? "text-base font-extrabold text-[#f5e6b0] text-center"
                    : "text-sm font-semibold text-emerald-100/60 text-center"
                }
              >
                {opt.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

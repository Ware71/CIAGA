// src/components/stats/Wheel.tsx
"use client";

import { useEffect, useRef } from "react";

export function Wheel({
  values,
  value,
  onChange,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, values.findIndex((x) => x === value));
    const item = el.querySelectorAll<HTMLElement>("[data-wheel-item]")[idx];
    if (item) item.scrollIntoView({ block: "center", behavior: "instant" as any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;

    let best: { v: number; dist: number } | null = null;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-wheel-item]"));
    for (const it of items) {
      const r = it.getBoundingClientRect();
      const c = r.top + r.height / 2;
      const dist = Math.abs(c - mid);
      const v = Number(it.dataset.value);
      if (!Number.isFinite(v)) continue;
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
        className="h-52 overflow-y-auto scroll-smooth snap-y snap-mandatory py-8"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {values.map((v) => {
          const active = v === value;
          return (
            <div key={v} data-wheel-item data-value={v} className="h-10 snap-center flex items-center justify-center">
              <div
                className={
                  active
                    ? "text-xl font-extrabold text-[#f5e6b0] tabular-nums"
                    : "text-base font-semibold text-emerald-100/70 tabular-nums"
                }
              >
                {v.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

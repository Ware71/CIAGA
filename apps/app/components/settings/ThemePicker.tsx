"use client";

import { Check } from "lucide-react";
import { THEMES, type Theme } from "@/lib/theme/themes";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * The theme picker.
 *
 * Each option shows TWO chips, not one: the app's palette and the Majors
 * palette beside it. Every theme changes both, and the Majors half is the part
 * you can't preview by standing on this screen — so the picker has to show it.
 *
 * A chip is a real three-band sample — ground, surface, accent — rather than a
 * dot, because the ground is most of what you actually see. Choosing applies
 * immediately; the screen repaints under your finger, which is the only honest
 * preview of the other half.
 */
function Chip({
  bands,
  on,
  accentRing,
}: {
  bands: [string, string, string];
  on: boolean;
  accentRing: string;
}) {
  const [ground, surface, accent] = bands;
  return (
    <span
      aria-hidden="true"
      className="relative block h-[40px] w-[34px] shrink-0 overflow-hidden rounded-[8px]"
      style={{
        background: ground,
        boxShadow: on
          ? `0 0 0 1px ${accentRing}, 0 0 0 3px color-mix(in srgb, ${accentRing} 28%, transparent)`
          : "inset 0 0 0 1px var(--sec-hair)",
      }}
    >
      <span
        className="absolute inset-x-[5px] bottom-[5px] h-[12px] rounded-[3px]"
        style={{ background: surface }}
      />
      <span
        className="absolute left-[5px] top-[5px] h-[8px] w-[14px] rounded-[2px]"
        style={{ background: accent }}
      />
    </span>
  );
}

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col">
      {THEMES.map((t: Theme) => {
        const on = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            aria-pressed={on}
            className="flex min-h-[var(--row-h)] items-center gap-3 border-b border-[color:var(--hair)] py-[var(--row-pv)] text-left transition-colors last:border-b-0 hover:bg-[color:var(--sec-surface)]"
          >
            <span className="flex shrink-0 items-center gap-[3px]">
              <Chip bands={t.swatch} on={on} accentRing={t.swatch[2]} />
              <Chip bands={t.majorsSwatch} on={on} accentRing={t.majorsSwatch[2]} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[length:var(--t-body)] text-[color:var(--sec-text)]">
                  {t.name}
                </span>
                <span className="rounded-full border border-[color:var(--hair)] px-[6px] py-[1px] text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
                  {t.scheme}
                </span>
              </span>
              <span className="mt-[2px] block text-[length:var(--t-sec)] leading-snug text-[color:var(--sec-muted)]">
                {t.blurb}
              </span>
            </span>

            {on ? (
              <Check
                size={18}
                strokeWidth={2.2}
                className="shrink-0 text-[color:var(--sec-accent)]"
              />
            ) : null}
          </button>
        );
      })}

      <p className="pt-3 text-[length:var(--t-sec)] leading-snug text-[color:var(--sec-muted)]">
        Two chips each: the app on the left, Majors on the right. Majors always goes a step
        deeper and swaps the accent metal, so you can tell which section you're in without
        reading the header.
      </p>
    </div>
  );
}

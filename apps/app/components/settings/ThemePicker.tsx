"use client";

import { Check } from "lucide-react";
import { THEMES, type Theme } from "@/lib/theme/themes";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * The theme picker.
 *
 * Each option is a real three-band chip — ground, surface, accent — rather than
 * a name and a dot, because the ground is most of what you actually see and a
 * single dot tells you nothing about it. Choosing applies immediately: the
 * whole screen repaints under your finger, which is the only honest preview.
 */
function Chip({ theme, on }: { theme: Theme; on: boolean }) {
  const [ground, surface, accent] = theme.swatch;
  return (
    <span
      aria-hidden="true"
      className="relative grid h-[42px] w-[42px] shrink-0 place-items-center overflow-hidden rounded-[10px]"
      style={{
        background: ground,
        boxShadow: on
          ? `0 0 0 1px ${accent}, 0 0 0 3px color-mix(in srgb, ${accent} 30%, transparent)`
          : "inset 0 0 0 1px var(--sec-hair)",
      }}
    >
      <span className="absolute inset-x-[6px] bottom-[6px] h-[13px] rounded-[3px]" style={{ background: surface }} />
      <span className="absolute left-[6px] top-[6px] h-[9px] w-[16px] rounded-[2px]" style={{ background: accent }} />
    </span>
  );
}

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col">
      {THEMES.map((t) => {
        const on = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            aria-pressed={on}
            className="flex min-h-[var(--row-h)] items-center gap-3 border-b border-[color:var(--hair)] py-[var(--row-pv)] text-left transition-colors last:border-b-0 hover:bg-[color:var(--sec-surface)]"
          >
            <Chip theme={t} on={on} />
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
              <Check size={18} className="shrink-0 text-[color:var(--sec-accent)]" strokeWidth={2.2} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

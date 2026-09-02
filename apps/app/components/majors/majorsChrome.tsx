import type { ReactNode } from "react";

/**
 * Shared chrome for the Majors surface — the "Emerald Foil" scheme.
 *
 * Majors is the flagship section, and it earns a look of its own rather than the
 * app's default emerald cards. The difference is structural as well as tonal: a
 * masthead instead of a centred page title, section labels carried on a gold
 * rule, and one card surface everywhere so the page reads as a set.
 *
 * The palette stays in the app's own family but stops being timid about it. The
 * ground drops to #03150C (against #042713 elsewhere), cards run a genuine
 * gradient from #11512C to #07351B rather than a flat tint, and the gold moves
 * from parchment cream (#f5e6b0) to a metallic #ffd666. Chosen from a set of
 * five reviewed directions; the alternatives were Blackout Gold, Claret & Brass
 * and Championship Navy, all of which changed hue rather than intensity.
 *
 * Anything rendered under /majors should use these rather than hand-rolling a
 * border, or the section drifts back towards looking like the rest of the app.
 */

/** The single card surface for this section: warm, raised, gold-edged. */
export const MAJORS_CARD =
  "rounded-2xl border border-[#ffd666]/30 bg-gradient-to-b from-[#11512C] to-[#07351B] shadow-[inset_0_1px_0_rgba(255,214,102,0.18),0_2px_14px_rgba(0,0,0,0.35)]";

/** Interactive variant — same surface, with a press/hover response. */
export const MAJORS_CARD_INTERACTIVE = `${MAJORS_CARD} transition hover:border-[#ffd666]/50 active:scale-[0.995]`;

/** The section's accent, for anything that can't take a class. */
export const MAJORS_GOLD = "#ffd666";

/**
 * A section heading: gold micro-label, then a rule that fades out across the
 * remaining width. The rule is what stops a column of cards reading as one
 * undifferentiated stack.
 */
export function MajorsSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#ffd666]/85">
          {title}
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-[#ffd666]/70 to-transparent" />
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The page masthead. Every other screen in the app centres a small title between
 * two controls; Majors sets its name in large letterspaced gold over a rule, so
 * arriving here feels like entering a different room.
 */
export function MajorsMasthead({
  left,
  right,
  subtitle,
}: {
  left?: ReactNode;
  right?: ReactNode;
  subtitle?: string;
}) {
  return (
    <header className="px-4 pt-8 pb-5">
      <div className="flex items-start justify-between">
        <div className="pt-1">{left}</div>
        <div className="flex shrink-0 items-center gap-3">{right}</div>
      </div>

      <div className="mt-4">
        <h1 className="text-[26px] font-extrabold uppercase leading-none tracking-[0.2em] text-[#ffd666] drop-shadow-[0_1px_10px_rgba(255,214,102,0.18)]">
          Majors
        </h1>
        {subtitle ? (
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200/50">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="mt-4 h-px bg-gradient-to-r from-[#ffd666]/80 via-[#ffd666]/25 to-transparent" />
    </header>
  );
}

import type { ReactNode } from "react";
import { BackButton } from "@/components/ui/BackButton";

/**
 * The app's page chrome: a masthead, section labels carried on a rule, and one
 * card surface. Built for Majors, now shared everywhere.
 *
 * The structure is the point. Before this, each hub centred a small title
 * between two controls and then stacked cards with no grouping, so every screen
 * read as a pile rather than a composition. These three primitives are the whole
 * vocabulary — if a page needs a border, it takes CARD rather than inventing one.
 *
 * Colour comes from the `--sec-*` tokens in globals.css, not literals, so a
 * section restyles itself by redefining that block (see body[data-section]).
 * That's why these are Tailwind arbitrary values wrapping CSS variables rather
 * than plain utility classes: one component, any palette.
 */

/** The single card surface. */
export const CARD =
  "rounded-2xl border border-[color:var(--sec-line)] bg-[linear-gradient(180deg,var(--sec-from),var(--sec-to))] shadow-[inset_0_1px_0_var(--sec-sheen),0_2px_14px_rgba(0,0,0,0.35)]";

/** Interactive variant — same surface, with a press/hover response. */
export const CARD_INTERACTIVE = `${CARD} transition hover:border-[color:var(--sec-line-strong)] active:scale-[0.995]`;

/** Accent text, for anything that can't take a component. */
export const ACCENT_TEXT = "text-[color:var(--sec-accent)]";

/**
 * A section heading: micro-caps, then a rule that fades out across the remaining
 * width. The rule is what stops a column of cards reading as one stack.
 */
export function Section({
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
        <h2 className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--sec-accent)] opacity-85">
          {title}
        </h2>
        <div className="h-px flex-1 bg-[linear-gradient(90deg,var(--sec-line-strong),transparent)]" />
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The page masthead — for tab roots and section hubs, where the page's name is
 * the most useful thing at the top.
 *
 * Leaf pages should NOT use this: they need a way back, and a full masthead
 * crowds it out. Pass `backHref` for the in-between case (a hub one level down,
 * like Schedule), which keeps the name at size with a back link above it.
 */
export function Masthead({
  title,
  subtitle,
  left,
  right,
  backHref,
  backLabel,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  const hasTopRow = Boolean(left || right || backHref);

  return (
    <header className="px-4 pt-8 pb-5">
      {hasTopRow && (
        <div className="flex items-start justify-between gap-3">
          <div className="pt-1">
            {backHref ? (
              <BackButton href={backHref} label={backLabel} className="-ml-2 font-semibold" />
            ) : (
              left
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">{right}</div>
        </div>
      )}

      <div className={hasTopRow ? "mt-4" : undefined}>
        <h1 className="text-[26px] font-extrabold uppercase leading-none tracking-[0.2em] text-[color:var(--sec-accent)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="mt-4 h-px bg-[linear-gradient(90deg,var(--sec-line-strong),var(--sec-line)_45%,transparent)]" />
    </header>
  );
}

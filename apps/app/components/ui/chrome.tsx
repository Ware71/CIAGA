import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The app's page chrome: a compact header, groups of rows under a labelled rule,
 * and one flat panel surface.
 *
 * This replaces the tracked-out uppercase masthead and the gradient card that
 * shipped in c9f2d5c. The structure that commit introduced was right — the
 * setting was not. The app had fifteen type sizes across two scales that never
 * lined up, 90% of its weight declarations at semibold or heavier, and nine
 * corner radii. Nothing could recede, so nothing stood out.
 *
 * The system is in globals.css (`--t-*`, `--w-*`, `--sp-*`, `--r-ui`, `--hair*`)
 * and everything here is built from it. Colour still comes from the `--sec-*`
 * block, so a section restyles itself by redefining that — see body[data-section].
 *
 * Three rules worth keeping:
 *
 *   Values live in a right-hand column with tabular figures, so a list of scores
 *   scans down a column rather than a ragged edge.
 *
 *   The accent has one job — a live figure, an active state, and the rule under
 *   a section label. It is not a border, a sheen, or body text.
 *
 *   A row is at least 44pt tall, so nothing on a screen is harder to hit than
 *   anything else.
 */

/* ────────────────────────────────────────────────────────────────────────────
   Surfaces
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The panel surface — a flat fill and one hairline, no gradient and no sheen.
 *
 * Prefer `Group` + `Row`: most things that reach for a card are really a list.
 * This is for content that genuinely is a discrete object, and for the leaf
 * pages that still carry their own markup.
 */
export const CARD =
  "rounded-[var(--r-ui)] border border-[color:var(--hair-panel)] bg-[color:var(--fill-panel)]";

/** Interactive variant — same surface, with a press/hover response. */
export const CARD_INTERACTIVE = `${CARD} transition hover:bg-[color:var(--sec-surface-2)] active:scale-[0.995]`;

/** Accent text, for anything that can't take a component. */
export const ACCENT_TEXT = "text-[color:var(--sec-accent)]";

/* ────────────────────────────────────────────────────────────────────────────
   Header
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The page header. One 52pt bar, left-aligned, in three states:
 *
 *   brand   Home only — the mark and wordmark as a lockup.
 *   tab     A tab root — the screen's name at 17px.
 *   leaf    A page below a tab — the parent above the name, so the way back is
 *           part of the title block rather than a centred control fighting it.
 *
 * Titles are left-aligned in every state: a centred title truncates badly, and
 * course and society names are long.
 */
export function PageHeader({
  title,
  subtitle,
  parent,
  parentHref,
  actions,
  brand = false,
  className,
}: {
  title: string;
  subtitle?: string;
  /** Leaf pages: the name of the screen above this one. */
  parent?: string;
  parentHref?: string;
  actions?: ReactNode;
  /** Home only — renders the mark + wordmark lockup instead of a title. */
  brand?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-[48px] items-center justify-between gap-2.5 pb-2.5 pt-3",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {brand ? (
          <>
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center overflow-hidden rounded-full bg-[color:var(--nav-emblem)]">
              <Image
                src="/ciaga-logo.png"
                alt=""
                width={30}
                height={30}
                className="h-full w-full object-contain"
              />
            </span>
            <span className="flex min-w-0 flex-col gap-[3px]">
              <span className="truncate text-[length:var(--t-word)] font-semibold leading-[1.25] tracking-[-0.01em] text-[color:var(--sec-text)]">
                {title}
              </span>
              {subtitle ? (
                <span className="truncate text-[length:var(--t-label)] font-medium uppercase leading-[1.35] tracking-[0.1em] text-[color:var(--sec-muted)]">
                  {subtitle}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <div className="flex min-w-0 flex-col gap-[3px]">
            {parent && parentHref ? (
              <Link
                href={parentHref}
                className="truncate text-[length:var(--t-sec)] font-normal leading-[1.35] text-[color:var(--sec-muted)] transition-colors hover:text-[color:var(--sec-text)]"
              >
                ‹ {parent}
              </Link>
            ) : null}
            <h1 className="truncate text-[length:var(--t-fig)] font-semibold leading-tight tracking-[-0.01em] text-[color:var(--sec-text)]">
              {title}
            </h1>
            {subtitle ? (
              <p className="truncate text-[length:var(--t-sec)] font-normal leading-[1.35] text-[color:var(--sec-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * Kept so the existing call sites don't all churn; `left` is dropped because the
 * header no longer has a slot for it (the back link now lives in the title
 * block). New code should use `PageHeader`.
 */
export function Masthead({
  title,
  subtitle,
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
  // Call sites pass "← More"; PageHeader draws its own chevron.
  const parent = backLabel?.replace(/^[←‹<\s]+/, "").trim() || "Back";

  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      parent={backHref ? parent : undefined}
      parentHref={backHref}
      actions={right}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Grouping
   ──────────────────────────────────────────────────────────────────────── */

/**
 * A labelled group of rows. The label sits on a full-width accent rule, which
 * gives the group a top edge without wrapping it in a box — the reason the old
 * card fill existed, at a fraction of the visual cost.
 */
export function Group({
  label,
  action,
  children,
  className,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-[var(--sp-grp)]", className)}>
      <div className="flex items-baseline gap-3 border-b border-[color:var(--sec-rule)] pb-[5px]">
        <h2 className="shrink-0 text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
          {label}
        </h2>
        {action ? (
          <div className="ml-auto shrink-0 text-[length:var(--t-sec)] font-medium text-[color:var(--sec-text-2)]">
            {action}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * The previous section primitive, kept for call sites whose children bring their
 * own spacing. Same label-on-a-rule as `Group`, but it doesn't lay the children
 * out — so an existing `space-y-*` stack still works.
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
    <section>
      <div className="flex items-baseline gap-3 border-b border-[color:var(--sec-rule)] pb-[5px]">
        <h2 className="shrink-0 text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
          {title}
        </h2>
        {action ? (
          <div className="ml-auto shrink-0 text-[length:var(--t-sec)] font-medium text-[color:var(--sec-text-2)]">
            {action}
          </div>
        ) : null}
      </div>
      <div className="mt-[var(--sp-lab)]">{children}</div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Rows
   ──────────────────────────────────────────────────────────────────────── */

export type RowTone = "default" | "accent" | "good" | "bad";

const TONE: Record<RowTone, string> = {
  default: "text-[color:var(--sec-text)]",
  accent: "text-[color:var(--sec-accent)]",
  good: "text-emerald-400",
  bad: "text-red-400",
};

/**
 * One row: an optional lead (avatar, icon, position), a title over an optional
 * sub-line, and a value pinned right.
 *
 * Almost every screen in the app is this, repeated. Rendering as a link when
 * `href` is given keeps prefetch and middle-click working, which a div with an
 * onClick does not.
 */
export function Row({
  lead,
  title,
  subtitle,
  value,
  tone = "default",
  aux,
  trailing,
  live = false,
  href,
  onClick,
  className,
}: {
  lead?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Pinned right, tabular. */
  value?: ReactNode;
  tone?: RowTone;
  /** A quiet figure between the title and the value — "thru 14", "3W". */
  aux?: ReactNode;
  /** Anything that isn't a value: a pill, a chevron. */
  trailing?: ReactNode;
  /** Draws the accent stripe down the left edge. */
  live?: boolean;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {live && (
        <span
          aria-hidden="true"
          className="absolute bottom-[var(--row-pv)] left-0 top-[var(--row-pv)] w-[2px] rounded-full bg-[color:var(--sec-accent)]"
        />
      )}
      {lead ? <span className="flex shrink-0 items-center">{lead}</span> : null}

      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="truncate text-[length:var(--t-body)] font-normal text-[color:var(--sec-text)]">
          {title}
        </span>
        {subtitle ? (
          <span className="truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            {subtitle}
          </span>
        ) : null}
      </span>

      {aux ? (
        <span className="shrink-0 text-[length:var(--t-sec)] tabular-nums text-[color:var(--sec-muted)]">
          {aux}
        </span>
      ) : null}

      {value !== undefined && value !== null ? (
        <span
          className={cn(
            "shrink-0 text-right text-[length:var(--t-fig)] font-medium tabular-nums tracking-[-0.01em]",
            TONE[tone]
          )}
        >
          {value}
        </span>
      ) : null}

      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </>
  );

  const classes = cn(
    "relative flex min-h-[var(--row-h)] w-full items-center gap-[10px] border-b border-[color:var(--hair)] py-[var(--row-pv)] text-left last:border-b-0",
    live && "pl-[9px]",
    (href || onClick) && "transition-colors hover:bg-[color:var(--sec-surface)]",
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

/**
 * The one large figure on a screen — a handicap index, a purse, a prize pot.
 * At most one per screen; a second competes with the first and neither reads.
 */
export function Hero({
  figure,
  caption,
  sideLabel,
  sideValue,
}: {
  figure: ReactNode;
  caption?: ReactNode;
  sideLabel?: string;
  sideValue?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-[color:var(--hair)] py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[length:var(--t-figlg)] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[color:var(--sec-accent)]">
          {figure}
        </div>
        {caption ? (
          <div className="mt-[6px] truncate text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
            {caption}
          </div>
        ) : null}
      </div>
      {sideLabel ? (
        <div className="shrink-0 text-right">
          <div className="text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
            {sideLabel}
          </div>
          <div className="mt-[3px] text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-text)]">
            {sideValue}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Two to four figures across, on one rule. For the set of numbers that belong to
 * a single thing — gross, points and differential for one round — where stacking
 * them as rows would imply they're separate.
 */
export function Strip({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <div className="flex border-b border-[color:var(--hair)] last:border-b-0">
      {items.map((it, i) => (
        <div
          key={it.label}
          className={cn(
            "min-w-0 flex-1 py-[var(--row-pv)]",
            i > 0 && "border-l border-[color:var(--hair)] pl-[10px]"
          )}
        >
          <div className="truncate text-[length:var(--t-label)] font-medium uppercase tracking-[0.1em] text-[color:var(--sec-muted)]">
            {it.label}
          </div>
          <div className="mt-[3px] text-[length:var(--t-fig)] font-medium tabular-nums text-[color:var(--sec-text)]">
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The screen's primary action — one per screen, full width, on the touch target.
 * An outline rather than a fill: the accent is louder than the ground, and a
 * solid block of it at this size pulls focus off the content above it.
 */
export function PrimaryAction({
  label,
  hint,
  href,
  onClick,
}: {
  label: string;
  hint?: string;
  href?: string;
  onClick?: () => void;
}) {
  const classes =
    "block w-full rounded-[var(--r-ui)] border border-[color:var(--sec-rule)] px-4 py-[11px] text-center transition-colors hover:bg-[color:var(--sec-surface)] active:scale-[0.99]";
  const body = (
    <>
      <span className="block text-[length:var(--t-body)] font-semibold text-[color:var(--sec-accent)]">
        {label}
      </span>
      {hint ? (
        <span className="mt-[2px] block text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
          {hint}
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}

/** A status tag. Filled when it's the live one, outlined otherwise. */
export function Tag({
  children,
  on = false,
}: {
  children: ReactNode;
  on?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-[length:var(--t-label)] uppercase tracking-[0.1em]",
        on
          ? "bg-[color:var(--sec-accent)] font-semibold text-[color:var(--ciaga-ground)]"
          : "border border-[color:var(--hair)] font-medium text-[color:var(--sec-muted)]"
      )}
    >
      {children}
    </span>
  );
}

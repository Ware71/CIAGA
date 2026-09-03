"use client";

import Link from "next/link";

/**
 * A way back into a live scorecard, floating just above the bottom bar.
 *
 * Home used to end in a "Resume round" button, which meant scrolling past three
 * groups of content to get back to a card you were halfway through. This rides
 * the viewport instead, in the nav's own surface so the two read as one system.
 *
 * The offset idiom (safe area + --ciaga-nav-h + a gap) is the same one the
 * social composer and the fantasy bet slip use. z-30 keeps it under the nav pill
 * (z-40) and the radial wheel's scrim (z-45), which it must never cover.
 *
 * /play deliberately does NOT render this — there the resume state replaces the
 * New round button, so a floating copy would say the same thing twice.
 */
export function ResumeRoundBar({ roundId, hint }: { roundId: string; hint?: string | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4 bottom-[calc(env(safe-area-inset-bottom)+var(--ciaga-nav-h)+12px)]">
      <Link
        href={`/round/${roundId}`}
        className="pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-full px-4 py-2.5 backdrop-blur-xl transition-transform active:scale-[0.99]"
        style={{
          backgroundColor: "color-mix(in srgb, var(--nav-pill) 92%, transparent)",
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 var(--nav-sheen), 0 0 0 1px var(--nav-ring)",
        }}
      >
        <span
          aria-hidden="true"
          className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-[color:var(--sec-accent)]"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[length:var(--t-body)] font-semibold text-[color:var(--sec-accent)]">
            Resume round
          </span>
          {hint ? (
            <span className="truncate text-[length:var(--t-label)] text-[color:var(--sec-muted)]">
              {hint}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[length:var(--t-fig)] leading-none text-[color:var(--sec-muted)]">
          ›
        </span>
      </Link>
    </div>
  );
}

export default ResumeRoundBar;

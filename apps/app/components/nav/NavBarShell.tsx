"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { TabDef } from "./navConfig";

/**
 * The floating pill both bottom bars share — the main nav and the Fantasy Picks
 * section bar. One surface so they read as the same system.
 *
 * Sits inset from the screen edges rather than flush, matching the app's
 * rounded-2xl card language, with the content behind visible through the gap.
 *
 * Colours come from the `--nav-*` tokens in globals.css rather than literals,
 * because the bar is mounted at the root and has to retint itself per section —
 * see AppFrame. They're applied inline: Tailwind can hold a CSS variable in an
 * arbitrary value, but not inside a colour-with-opacity shorthand, and half the
 * surfaces here need alpha.
 */
export function NavBarShell({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]">
      <nav
        aria-label={label}
        className="pointer-events-auto mx-auto mb-3 h-[60px] w-[calc(100%-1.5rem)] max-w-sm rounded-[28px] backdrop-blur-xl"
        style={{
          backgroundColor: "color-mix(in srgb, var(--nav-pill) 90%, transparent)",
          boxShadow:
            "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 var(--nav-sheen), 0 0 0 1px var(--nav-ring)",
        }}
      >
        <div className="mx-auto flex h-full max-w-sm items-center">{children}</div>
      </nav>
    </div>
  );
}

/**
 * One tab. Icon-only on the main bar (the label becomes the accessible name);
 * labelled on the Fantasy bar, where Wallet/Ticket/Trophy don't read on their own.
 */
export function NavTab({
  tab,
  active,
  showLabel = false,
  indicatorId,
}: {
  tab: TabDef;
  active: boolean;
  showLabel?: boolean;
  indicatorId: string;
}) {
  const reduceMotion = useReducedMotion();
  const { href, label, Icon, ActiveIcon } = tab;

  // Most tabs just restroke when active. A tab can instead swap glyph entirely —
  // the Play tee grows a ball — and swapping the component type (rather than
  // passing an `active` prop) is what lets the new glyph animate its entrance.
  const Glyph = active && ActiveIcon ? ActiveIcon : Icon;

  return (
    <Link
      href={href}
      aria-label={showLabel ? undefined : label}
      aria-current={active ? "page" : undefined}
      className="relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] transition-colors"
      style={{ color: active ? "var(--nav-accent)" : "var(--nav-idle)" }}
    >
      {/* A dot, not a filled pill. The tinted block made the bar look like it
          had a button pressed into it, and it competed with the docked logo
          beside it; the colour change on the icon already says which tab you
          are on, so the indicator only has to confirm it. */}
      {active && (
        <motion.span
          layoutId={indicatorId}
          className="absolute bottom-[7px] h-[3px] w-[3px] rounded-full"
          style={{ backgroundColor: "var(--nav-accent)" }}
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }
          }
        />
      )}
      <span className="relative flex flex-col items-center gap-0.5">
        <Glyph className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
        {showLabel && <span className="text-[10px] font-semibold">{label}</span>}
      </span>
    </Link>
  );
}

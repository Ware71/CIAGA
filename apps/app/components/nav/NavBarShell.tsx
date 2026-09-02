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
        className="pointer-events-auto mx-auto mb-3 h-[60px] w-[calc(100%-1.5rem)] max-w-sm rounded-[28px] bg-[#07301a]/90 ring-1 ring-emerald-300/12 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(245,230,176,0.07)]"
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
  const { href, label, Icon } = tab;

  return (
    <Link
      href={href}
      aria-label={showLabel ? undefined : label}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] transition-colors ${
        active ? "text-[#f5e6b0]" : "text-emerald-200/45 hover:text-emerald-100/80"
      }`}
    >
      {active && (
        <motion.span
          layoutId={indicatorId}
          className="absolute inset-1 rounded-[22px] bg-[#f5e6b0]/10 ring-1 ring-[#f5e6b0]/20"
          transition={
            reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }
          }
        />
      )}
      <span className="relative flex flex-col items-center gap-0.5">
        <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
        {showLabel && <span className="text-[10px] font-semibold">{label}</span>}
      </span>
    </Link>
  );
}

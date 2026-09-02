"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { hidesMainNav } from "./navConfig";

/**
 * Mounts the bottom nav and reserves room for it.
 *
 * One wrapper here covers every `min-h-screen` page in the app, which is the same
 * trick the Fantasy section's layout already used. Screens that hard-pin to the
 * viewport height with their own inner scroller subtract `--ciaga-nav-h`
 * themselves — a parent's padding can't help those.
 *
 * `children` is passed through as a prop, so the pages inside stay server
 * components despite this boundary.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const hidden = hidesMainNav(pathname);

  return (
    <>
      <div
        className={
          hidden ? undefined : "pb-[calc(env(safe-area-inset-bottom)+var(--ciaga-nav-h))]"
        }
      >
        {children}
      </div>
      <BottomNav />
    </>
  );
}

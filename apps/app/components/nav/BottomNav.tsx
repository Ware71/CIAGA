"use client";

import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { NavBarShell, NavTab } from "./NavBarShell";
import { RadialMenu } from "./RadialMenu";
import { useLongPress } from "./useLongPress";
import { TABS_LEFT, TABS_RIGHT, hidesMainNav, wheelItemsFor } from "./navConfig";

/**
 * The app's primary navigation: Majors · Social · [logo] · Calendar · More.
 *
 * The logo is the old rising, spinning wheel button, now docked into the bar and
 * standing proud of its top edge. Tap goes home; press and hold raises the
 * wheel with options scoped to the current section.
 *
 * The rise is a framer-motion shared layout animation: the same `layoutId` is
 * rendered docked in the bar when closed and centred in the viewport when open,
 * so the transition needs no viewport arithmetic and stays correct across safe
 * areas, keyboards and rotation.
 *
 * Two things about that which are easy to get wrong:
 *
 *  - There is NO AnimatePresence here. Wrapping the open logo in one made it
 *    play an exit while the docked one mounted, so both existed for a few frames
 *    and the shared-layout handoff had two candidates to fly between. Rendering
 *    exactly one at a time lets layoutId own the flight in both directions.
 *  - `rotate` must NOT live on the element carrying `layoutId` — transforms
 *    fight layout projection. The spin goes on an inner span, and it needs an
 *    explicit `initial`, because a freshly mounted element defaults its initial
 *    to its animate value and would render at 360deg having never turned.
 */

const LOGO_LAYOUT_ID = "ciaga-nav-logo";
const LOGO_SPRING = { type: "spring", stiffness: 200, damping: 18 } as const;

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);

  // A route change while the wheel is open should close it.
  useEffect(() => setOpen(false), [pathname]);

  const close = useCallback(() => setOpen(false), []);
  const longPress = useLongPress(useCallback(() => setOpen(true), []));

  if (hidesMainNav(pathname)) return null;

  const items = wheelItemsFor(pathname);

  // One full turn as it flies to the centre. Skipped entirely under
  // prefers-reduced-motion, where the position change alone carries the meaning.
  const spin = reduceMotion
    ? { initial: false as const, animate: {} }
    : { initial: { rotate: 0 }, animate: { rotate: 360 } };

  return (
    <>
      <RadialMenu open={open} items={items} onClose={close} />

      <NavBarShell label="Main">
        {TABS_LEFT.map((tab) => (
          <NavTab
            key={tab.href}
            tab={tab}
            active={tab.match(pathname)}
            indicatorId="ciaga-main-nav-pill"
          />
        ))}

        {/* Reserves the centre slot. h-full matters: the parent row is
            items-center, so without a definite height this slot collapses to
            auto and `bottom-0` would have nothing to resolve against. */}
        <div className="relative flex h-full w-[92px] shrink-0 justify-center">
          {!open && (
            <motion.button
              layoutId={LOGO_LAYOUT_ID}
              type="button"
              aria-label="Home — press and hold for quick navigation"
              aria-haspopup="menu"
              aria-expanded={false}
              onClick={() => router.push("/home")}
              {...longPress}
              className="absolute bottom-0 h-[84px] w-[84px] overflow-hidden rounded-full shadow-[0_6px_20px_rgba(0,0,0,0.55)]"
              style={{
                backgroundColor: "var(--nav-emblem)",
                boxShadow:
                  "0 6px 20px rgba(0,0,0,0.55), 0 0 0 1px color-mix(in srgb, var(--nav-accent) 34%, transparent)",
              }}
            >
              <Image
                src="/ciaga-logo.png"
                alt=""
                width={84}
                height={84}
                className="h-full w-full object-contain"
                priority
              />
            </motion.button>
          )}
        </div>

        {TABS_RIGHT.map((tab) => (
          <NavTab
            key={tab.href}
            tab={tab}
            active={tab.match(pathname)}
            indicatorId="ciaga-main-nav-pill"
          />
        ))}
      </NavBarShell>

      {/* Open state: same layoutId, so it flies from the bar to the centre. */}
      {open && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
          <motion.button
            layoutId={LOGO_LAYOUT_ID}
            type="button"
            aria-label="Close quick navigation"
            aria-haspopup="menu"
            aria-expanded
            onClick={close}
            className="pointer-events-auto h-[112px] w-[112px] overflow-hidden rounded-full"
            style={{
              backgroundColor: "var(--nav-emblem)",
              boxShadow:
                "0 8px 28px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in srgb, var(--nav-accent) 65%, transparent)",
            }}
          >
            <motion.span
              className="block h-full w-full"
              initial={spin.initial}
              animate={spin.animate}
              transition={LOGO_SPRING}
            >
              <Image
                src="/ciaga-logo.png"
                alt=""
                width={112}
                height={112}
                className="h-full w-full object-contain"
              />
            </motion.span>
          </motion.button>
        </div>
      )}
    </>
  );
}

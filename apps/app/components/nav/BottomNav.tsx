"use client";

import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { NavBarShell, NavTab } from "./NavBarShell";
import { RadialMenu } from "./RadialMenu";
import { useLongPress } from "./useLongPress";
import { TABS_LEFT, TABS_RIGHT, hidesMainNav, wheelItemsFor } from "./navConfig";

/**
 * The app's primary navigation: Social · Majors · [logo] · Calendar · More.
 *
 * The logo is the old rising, spinning wheel button, now docked into the bar.
 * Tap goes home; press and hold raises the wheel with options scoped to the
 * current section.
 *
 * The rise is a framer-motion shared layout animation: the same `layoutId` is
 * rendered docked in the bar when closed and centred in the viewport when open,
 * so the transition needs no viewport arithmetic and stays correct across safe
 * areas, keyboards and rotation.
 */

const LOGO_LAYOUT_ID = "ciaga-nav-logo";

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
  const spin = reduceMotion ? {} : { rotate: open ? 360 : 0 };

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

        {/* Reserves the centre slot; the logo itself is rendered below so it can
            break the pill's top edge and fly to the viewport centre. */}
        <div className="relative flex w-16 shrink-0 justify-center">
          {!open && (
            <motion.button
              layoutId={LOGO_LAYOUT_ID}
              type="button"
              aria-label="Home — press and hold for quick navigation"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => router.push("/home")}
              {...longPress}
              className="absolute -top-7 grid h-14 w-14 place-items-center rounded-full bg-[#0a341c] ring-1 ring-[#f5e6b0]/25 shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
            >
              <motion.span
                className="grid h-11 w-11 place-items-center overflow-hidden rounded-full"
                animate={spin}
                transition={{ type: "spring", stiffness: 200, damping: 18 }}
              >
                <Image
                  src="/ciaga-logo.png"
                  alt=""
                  width={44}
                  height={44}
                  className="h-full w-full object-contain"
                />
              </motion.span>
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
      <AnimatePresence>
        {open && (
          <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center">
            <motion.button
              layoutId={LOGO_LAYOUT_ID}
              type="button"
              aria-label="Close quick navigation"
              aria-haspopup="menu"
              aria-expanded
              onClick={close}
              className="pointer-events-auto grid h-20 w-20 place-items-center rounded-full bg-[#0a341c] ring-1 ring-[#f5e6b0]/60 shadow-[0_6px_24px_rgba(0,0,0,0.55)]"
            >
              <motion.span
                className="grid h-16 w-16 place-items-center overflow-hidden rounded-full"
                animate={spin}
                transition={{ type: "spring", stiffness: 200, damping: 18 }}
              >
                <Image
                  src="/ciaga-logo.png"
                  alt=""
                  width={64}
                  height={64}
                  className="h-full w-full object-contain"
                />
              </motion.span>
            </motion.button>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

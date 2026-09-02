"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import type { WheelItem } from "./navConfig";

/**
 * The spinning wheel, lifted out of HomeClient's closure so every screen can raise
 * it from the docked nav logo.
 *
 * Geometry is now computed for N items rather than read from a five-slot array —
 * the old hardcoded `wheelPositions` silently stacked a sixth item on top of the
 * logo, and /stats needs six.
 */

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Points on a squashed circle, starting at 12 o'clock and going clockwise.
 *
 * The radii are bounded at both ends, which is what makes the ring read as
 * even. The lower bound keeps every item clear of the 112px logo at the centre;
 * the upper bound keeps the widest item inside the viewport. Items are a fixed
 * width, so the ring stays regular whether a label says "Stats" or "Course
 * Records" — letting them size to their text was what made it look scattered.
 */
const ITEM_W = 108;
const LOGO_R = 56;
const GAP = 14;
const EDGE = 10;

function wheelPositions(count: number, radiusY: number, radiusX: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return { x: radiusX * Math.cos(angle), y: radiusY * Math.sin(angle) };
  });
}

export function RadialMenu({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: WheelItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState({ vw: 0, vh: 0 });

  useEffect(() => {
    const measure = () =>
      setSize({
        vw: window.visualViewport?.width ?? window.innerWidth,
        vh: window.visualViewport?.height ?? window.innerHeight,
      });
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  // Close on Escape — the scrim covers pointer dismissal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Horizontal: far enough out that a full-width item clears the logo, near
  // enough in that it still fits on screen. On a 390px viewport that band is
  // roughly [122, 135], so the clamp does real work rather than decorating.
  const minX = LOGO_R + ITEM_W / 2 + GAP;
  const maxX = Math.max(minX, size.vw / 2 - ITEM_W / 2 - EDGE);
  const radiusX = clamp(size.vw * 0.33, minX, maxX);

  // Vertical has more room, so the ring is a touch taller than it is wide.
  const radiusY = clamp(size.vh * 0.19, LOGO_R + 44, 172);
  const positions = wheelPositions(items.length, radiusY, radiusX);

  const select = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[45] backdrop-blur-md bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <div role="menu" aria-label="Quick navigation">
            {items.map((item, index) => {
              const pos = positions[index];
              return (
                <motion.button
                  key={item.id}
                  role="menuitem"
                  onClick={() => select(item.href)}
                  className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 pointer-events-auto flex h-9 items-center justify-center rounded-full px-3 text-center text-[11px] font-semibold leading-tight tracking-wide shadow-lg backdrop-blur-sm"
                  style={{
                    width: ITEM_W,
                    backgroundColor: "color-mix(in srgb, var(--nav-pill) 95%, transparent)",
                    color: "var(--nav-accent)",
                    boxShadow:
                      "0 4px 16px rgba(0,0,0,0.45), 0 0 0 1px color-mix(in srgb, var(--nav-accent) 38%, transparent)",
                  }}
                  initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                  animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y }}
                  exit={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 260, damping: 20, delay: 0.05 * index }
                  }
                >
                  {item.label}
                </motion.button>
              );
            })}
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

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

/** Points on a squashed circle, starting at 12 o'clock and going clockwise. */
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

  const radiusY = clamp(Math.min(size.vw, size.vh) * 0.38, 115, 170);
  const radiusX = clamp(radiusY * 0.85, 90, 120);
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
                  className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 pointer-events-auto flex items-center justify-center rounded-full border border-emerald-200/70 bg-[#0b3b21]/95 px-4 py-2 text-xs font-medium tracking-wide shadow-lg"
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

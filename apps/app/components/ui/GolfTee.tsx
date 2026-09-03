"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The Play tab's two-state glyph, drawn rather than borrowed.
 *
 * lucide has no golf mark, and the unicode alternatives (⛳ 🏌) carry emoji
 * presentation defaults on Windows and Android — the same font-stack gamble
 * DirectionArrow was drawn to avoid, on exactly the mobile platforms this PWA
 * targets.
 *
 * Two components rather than one with an `active` prop, because the nav swaps
 * the component *type* on activation (see TabDef.ActiveIcon): React unmounts one
 * and mounts the other, so the ball's entrance fires once per activation and
 * never on a re-render. Tapping the tab tees the ball up.
 *
 * Both take `className` and `strokeWidth` so NavTab's 1.8 → 2.4 idle/active
 * stroke swap keeps working without knowing which glyph it has.
 */

type IconProps = {
  className?: string;
  strokeWidth?: number;
};

/**
 * Idle: a bare peg — a dished cup on a single stem.
 *
 * Drawn as two strokes, not as a tapered outline. An outline needs the two
 * flanks of the shaft within about a pixel of each other at 20px, where they
 * either merge into a blob or, opened up enough to separate, read as a funnel.
 * A cup over a stem survives the size and still says tee.
 */
export function TeeIcon({ className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Cup — lips up, dishing to about y=9.8 in the middle. Drawn wide: a tee
          is a narrow object, and at a nav's size a faithful one reads as a hair
          beside Trophy and LayoutGrid. The cup is what gives it presence. */}
      <path d="M6.2 6C7.6 11 16.4 11 17.8 6" />
      {/* Stem, from the base of the dish. The round cap softens it to a point. */}
      <path d="M12 9.7V20.5" />
    </svg>
  );
}

/** Active: the same peg, shortened, with a ball dropped into the cup. */
export function TeeBallIcon({ className, strokeWidth = 2.4 }: IconProps) {
  const reduceMotion = useReducedMotion();

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <motion.circle
        cx="12"
        cy="5.4"
        r="3.4"
        initial={reduceMotion ? false : { y: -5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 620, damping: 26 }
        }
      />
      {/* The same cup, pressed down under the weight of the ball sitting in it —
          its lips still flare wider than the ball, so it stays a tee and not a pin. */}
      <path d="M7 8.6C8.3 12.4 15.7 12.4 17 8.6" />
      <path d="M12 10.3V21" />
    </svg>
  );
}

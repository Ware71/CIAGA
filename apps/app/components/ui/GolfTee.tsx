"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The Play tab's two-state glyph, traced from the CIAGA mark.
 *
 * Filled, not stroked — the one construction that keeps the logo's true
 * silhouette at nav size. Outlining it was tried five ways and fails: the
 * needle's two flanks land under a pixel apart at 20px, so they merge with the
 * dished rim into a solid triangle and the tab reads as "∇". A filled shape has
 * no sub-pixel gap to lose, so the long thin spike survives intact.
 *
 * The proportions are the mark's own: a wide flare confined to the top third,
 * narrowing hard, then most of the height spent as a thin needle. Getting that
 * ratio right is what separates it from a goblet.
 *
 * Two components rather than one with an `active` prop, because the nav swaps
 * the component *type* on activation (see TabDef.ActiveIcon): React unmounts one
 * and mounts the other, so the ball's entrance fires once per activation and
 * never on a re-render. Tapping the tab tees the ball up.
 */

type IconProps = {
  className?: string;
  /**
   * Accepted and ignored. NavTab hands every glyph its idle/active stroke
   * weight; this one is painted rather than stroked, and says so instead of
   * making the caller special-case it.
   */
  strokeWidth?: number;
};

/**
 * The bare tee, using the full box — at Trophy's 20×20, a tee drawn small
 * enough to leave headroom reads as a hair beside it.
 *
 * One closed path: down the left flank to the point, back up the right, then
 * the dished rim closes it across the top. The flank control points sit well
 * inboard, which is what collapses the width early and leaves the long spike.
 */
const TEE_BARE =
  "M5.4 2.4C11.2 3.6 11.6 16 12 22.6C12.4 16 12.8 3.6 18.6 2.4C15.8 4.3 8.2 4.3 5.4 2.4Z";

/** The same tee, shorter, making room for the ball above it — as in the mark. */
const TEE_BALL =
  "M7.4 8.4C11.3 9.3 11.6 17.4 12 22.6C12.4 17.4 12.7 9.3 16.6 8.4C14.8 9.7 9.2 9.7 7.4 8.4Z";

/** Idle: the bare tee. */
export function TeeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      className={className}
    >
      <path d={TEE_BARE} />
    </svg>
  );
}

/** Active: the same tee, with the ball dropped onto it. */
export function TeeBallIcon({ className }: IconProps) {
  const reduceMotion = useReducedMotion();

  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      className={className}
    >
      {/* The mark leaves daylight between ball and tee — it rests above the
          flare rather than in it. Keeping that gap is most of what reads as CIAGA. */}
      <motion.circle
        cx="12"
        cy="4.3"
        r="3.2"
        initial={reduceMotion ? false : { y: -5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 620, damping: 26 }
        }
      />
      <path d={TEE_BALL} />
    </svg>
  );
}

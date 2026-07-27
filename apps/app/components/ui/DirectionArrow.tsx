import React from "react";

export type ArrowDir = "nw" | "ne" | "sw" | "se";

/**
 * A diagonal arrow drawn as inline SVG rather than a unicode glyph.
 *
 * The glyphs (↖ ↗ ↙ ↘) carry emoji presentation defaults on Windows and
 * Android — they render as colour pictographs unless a U+FE0E variation
 * selector forces text mode, which is a font-stack gamble on exactly the mobile
 * platforms this PWA targets. Drawing it avoids the question entirely.
 *
 * `currentColor` means it inherits the chip's text colour, so it inverts for
 * free when a cell goes from unlit (pale emerald) to lit (dark on gold).
 */
const ROTATION: Record<ArrowDir, number> = {
  nw: 0,
  ne: 90,
  se: 180,
  sw: 270,
};

export function DirectionArrow({ dir, size = 14 }: { dir: ArrowDir; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="inline-block align-middle"
      style={{ transform: `rotate(${ROTATION[dir]}deg)` }}
    >
      {/* Base shape points north-west; the wrapper rotates it to the other three. */}
      <path
        d="M18 18L6 6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M6 13V6h7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default DirectionArrow;

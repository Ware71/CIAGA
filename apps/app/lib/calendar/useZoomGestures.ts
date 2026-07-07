"use client";

// Pinch-to-zoom for the interactive calendar. Pointer-event based so it works
// for touch and trackpad, plus a ctrl/⌘+wheel (trackpad pinch) fallback for the
// desktop. Because every zoom level now auto-fits the screen (no inner scroll),
// the gesture no longer competes with scrolling — the wrapper sets
// `touch-action: none` so a two-finger pinch is delivered here cleanly.
//
// A continuous pinch re-baselines after each step, so a long pinch smoothly
// walks several levels of the ladder; a short cooldown prevents jitter.

import { useCallback, useRef } from "react";

type Pt = { x: number; y: number };

// Ratio thresholds to step in/out — kept tight so zooming feels responsive.
const IN_RATIO = 1.18;
const OUT_RATIO = 0.85;
const STEP_COOLDOWN_MS = 110;

export function useZoomGestures(opts: { onZoomIn: () => void; onZoomOut: () => void }) {
  // Keep the latest callbacks in a ref so the handlers stay referentially stable.
  const cb = useRef(opts);
  cb.current = opts;

  const pointers = useRef(new Map<number, Pt>());
  const pinchBase = useRef<number | null>(null);
  const lastStep = useRef(0);

  const distance = (): number => {
    const pts = Array.from(pointers.current.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const step = useCallback((dir: 1 | -1) => {
    const now = Date.now();
    if (now - lastStep.current < STEP_COOLDOWN_MS) return;
    lastStep.current = now;
    if (dir === 1) cb.current.onZoomIn();
    else cb.current.onZoomOut();
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinchBase.current = distance();
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 2 && pinchBase.current != null) {
        const d = distance();
        if (pinchBase.current === 0) {
          pinchBase.current = d;
          return;
        }
        const ratio = d / pinchBase.current;
        if (ratio > IN_RATIO) {
          step(1);
          pinchBase.current = d; // re-baseline so a long pinch = multiple steps
        } else if (ratio < OUT_RATIO) {
          step(-1);
          pinchBase.current = d;
        }
      }
    },
    [step]
  );

  const end = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
  }, []);

  // Trackpad pinch arrives as a ctrl/⌘+wheel event on desktop browsers.
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    },
    [step]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    onWheel,
  };
}

"use client";

// Pinch + double-tap zoom for the interactive calendar. Pointer-event based so
// it works for touch and trackpad. A single pinch gesture steps zoom by one
// level (guarded by a moved-distance ratio), and a double-tap steps in. Callers
// should debounce the zoom callbacks themselves so overlapping gestures/taps
// collapse into a single step (see CalendarClient's cooldown).

import { useCallback, useRef } from "react";

type Pt = { x: number; y: number };

export function useZoomGestures(opts: { onZoomIn: () => void; onZoomOut: () => void }) {
  // Keep the latest callbacks in a ref so the handlers stay referentially stable.
  const cb = useRef(opts);
  cb.current = opts;

  const pointers = useRef(new Map<number, Pt>());
  const pinchBase = useRef<number | null>(null);

  const distance = (): number => {
    const pts = Array.from(pointers.current.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinchBase.current = distance();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchBase.current != null) {
      const d = distance();
      if (pinchBase.current === 0) {
        pinchBase.current = d;
        return;
      }
      const ratio = d / pinchBase.current;
      if (ratio > 1.3) {
        cb.current.onZoomIn();
        pinchBase.current = d; // re-baseline so a big pinch = one step
      } else if (ratio < 0.77) {
        cb.current.onZoomOut();
        pinchBase.current = d;
      }
    }
  }, []);

  const end = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchBase.current = null;
  }, []);

  const onDoubleClick = useCallback(() => cb.current.onZoomIn(), []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick,
  };
}

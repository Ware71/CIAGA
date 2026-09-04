"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Press-and-hold detection for the docked nav logo: tap navigates home, hold
 * raises the radial wheel.
 *
 * The app had no long-press anywhere before this. Two details matter:
 *
 *  - The click that follows a successful hold must be swallowed, or the logo
 *    would open the wheel AND navigate home on the same gesture.
 *  - Movement cancels. The logo sits in a fixed bar, but a hold that turns into
 *    a scroll should not fire.
 *
 * globals.css already sets `-webkit-touch-callout: none` and `user-select: none`
 * on body, so iOS won't raise its own callout menu over the top of this.
 */

const HOLD_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  // Set the moment a hold fires, so the synthetic click that follows can be eaten.
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Ignore secondary buttons; the context-menu handler covers right-click.
      if (e.button !== 0 && e.pointerType === "mouse") return;

      firedRef.current = false;
      originRef.current = { x: e.clientX, y: e.clientY };

      // Capture so we keep receiving move/up even if the finger drifts off the
      // button, matching the SwipeToDeleteRow convention used elsewhere.
      e.currentTarget.setPointerCapture?.(e.pointerId);

      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        timerRef.current = null;
        navigator.vibrate?.(10);
        onLongPress();
      }, HOLD_MS);
    },
    [onLongPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const origin = originRef.current;
      if (!origin || !timerRef.current) return;

      const dx = Math.abs(e.clientX - origin.x);
      const dy = Math.abs(e.clientY - origin.y);
      if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) clear();
    },
    [clear]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      clear();
    },
    [clear]
  );

  const onClickCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!firedRef.current) return;
    // The hold already opened the wheel — don't also run the tap action.
    firedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Desktop affordance: right-click raises the same menu.
  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      clear();
      onLongPress();
    },
    [clear, onLongPress]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClickCapture,
    onContextMenu,
  };
}

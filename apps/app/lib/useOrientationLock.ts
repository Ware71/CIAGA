"use client";

import { useEffect } from "react";

interface ScreenOrientationWithLock extends ScreenOrientation {
  lock?: (orientation: string) => Promise<void>;
}

type OrientationType = "portrait" | "landscape" | "any";

export function useOrientationLock(orientation: OrientationType) {
  useEffect(() => {
    const so = screen?.orientation as ScreenOrientationWithLock | undefined;
    if (typeof window === "undefined" || !so?.lock) return;

    let locked = false;

    if (orientation === "any") {
      so.unlock();
    } else {
      so.lock(orientation).then(
        () => { locked = true; },
        () => {},  // silently ignore — API requires installed PWA or fullscreen
      );
    }

    return () => {
      if (locked) so.unlock();
    };
  }, [orientation]);
}

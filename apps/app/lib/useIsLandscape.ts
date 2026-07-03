"use client";

import { useEffect, useState } from "react";

/** True when the viewport is in landscape orientation (reactive). */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(orientation: landscape)");
    const update = () => setLandscape(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return landscape;
}

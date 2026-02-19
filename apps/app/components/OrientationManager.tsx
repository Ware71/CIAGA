"use client";

import { useOrientationLock } from "@/lib/useOrientationLock";

export function OrientationManager() {
  useOrientationLock("portrait");
  return null;
}

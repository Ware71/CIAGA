"use client";

import { useEffect, useState } from "react";
import {
  isPushSupported,
  isStandalone,
  isIOS,
  notificationPermission,
  registerPush,
} from "@/lib/push/clientPush";

/**
 * Decides whether to show the recurring "Allow notifications" prompt on home.
 *
 * Cadence: device-local (localStorage) — push permission/subscription is
 * per-device, so a user on a new device should be asked there too. Once the
 * prompt is presented (shown OR stamped by onboarding) it won't reappear for
 * 3 months. Already-granted devices are never shown the modal; if granted but
 * not subscribed (e.g. a pruned subscription) we re-subscribe silently.
 */

const KEY = "ciaga_push_prompt_last_shown";
const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000; // ~3 months

function lastShownTs(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

/** Record that the push prompt was presented (starts/resets the 3-month clock). */
export function markPushPromptShown(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

function cooldownElapsed(): boolean {
  const t = lastShownTs();
  return t === null || Date.now() - t > COOLDOWN_MS;
}

export function shouldShowPushPrompt(): boolean {
  if (typeof window === "undefined") return false;
  const supported = isPushSupported();
  const iosInstallable = isIOS() && !isStandalone(); // can enable after install
  if (!supported && !iosInstallable) return false;
  if (notificationPermission() === "granted") return false;
  return cooldownElapsed();
}

export function usePushPrompt(params: { profileId: string | null; suppressed: boolean }) {
  const { profileId, suppressed } = params;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!profileId) return;

    // Already granted on this device: never nag, but make sure we hold a live
    // subscription (best-effort, no UI — requestPermission resolves instantly
    // when permission is already granted).
    if (isPushSupported() && notificationPermission() === "granted") {
      void registerPush();
      return;
    }

    if (suppressed) return;

    if (shouldShowPushPrompt()) {
      markPushPromptShown();
      setShow(true);
    }
  }, [profileId, suppressed]);

  return { show, dismiss: () => setShow(false) };
}

"use client";

import { useEffect, useState } from "react";
import {
  getPushDeliveryState,
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
 * 3 months.
 *
 * BROKEN-DELIVERY RE-PROMPT: "granted" is not proof of delivery. The server
 * prunes a subscription after a 404/410 (endpoint rotation, PWA reinstall, SW
 * replacement) and the browser keeps reporting "granted" forever. This used to
 * mean a user whose push silently died was never asked again — the prompt was
 * skipped on permission alone, and the 3-month cooldown hid it on top. We now
 * check ACTUAL delivery: try a silent re-subscribe first, and only surface the
 * prompt if that fails, which is the case the user cannot fix on their own.
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
    let cancelled = false;

    async function run() {
      if (isPushSupported() && notificationPermission() === "granted") {
        // Granted — but is anything actually being delivered?
        const state = await getPushDeliveryState();
        if (cancelled || state === "delivering") return;
        if (state === "unknown") {
          // Couldn't tell (offline, SW slow). Try the silent repair anyway and
          // don't escalate to a prompt on inconclusive evidence.
          void registerPush();
          return;
        }

        // not_registered — the silent case that used to swallow every push.
        const r = await registerPush();
        if (cancelled) return;
        if (r.status === "subscribed") return; // repaired, no need to bother them

        // Repair failed. This is worth interrupting for, and the 3-month
        // cooldown is deliberately ignored: it exists to stop nagging people
        // who said no, not to hide a broken state they never chose.
        if (!suppressed) {
          markPushPromptShown();
          setShow(true);
        }
        return;
      }

      if (suppressed) return;
      if (shouldShowPushPrompt()) {
        markPushPromptShown();
        setShow(true);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [profileId, suppressed]);

  return { show, dismiss: () => setShow(false) };
}

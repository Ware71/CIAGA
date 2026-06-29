"use client";

import { supabase } from "@/lib/supabaseClient";

/**
 * Web Push (VAPID) client helpers.
 *
 * iOS note: Web Push only works when the app is installed to the home screen
 * (iOS 16.4+, standalone display mode). In a normal Safari tab `pushManager`
 * is unavailable. Use `isPushSupported()` + `isStandalone()` to decide whether
 * to offer the "Enable notifications" button or the "Add to Home Screen" hint.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** URL-safe base64 of an ArrayBuffer (for comparing applicationServerKey). */
function bufToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Race a promise against a timeout. iOS WebKit can leave `serviceWorker.ready`
 * or `pushManager.subscribe()` pending forever; without this the "Enable
 * notifications" button hangs on "Enabling…" indefinitely.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** True when running as an installed PWA (required for push on iOS). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari exposes navigator.standalone; other platforms use display-mode.
  const iosStandalone = (window.navigator as any).standalone === true;
  const displayModeStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return iosStandalone || displayModeStandalone;
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports as Mac with touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

async function authedFetch(input: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body) headers.set("Content-Type", "application/json");
  return fetch(input, { ...init, headers });
}

export type RegisterPushResult =
  | { status: "subscribed" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "needs_install" }
  | { status: "error"; error: string };

/**
 * Request permission (must be called from a user gesture) and register a push
 * subscription. Returns a status the UI can react to.
 *
 * Every async step is bounded by a timeout and reported via `onStep`, so the UI
 * can never hang on "Enabling…" and we can see exactly where iOS stalls.
 */
export async function registerPush(opts?: {
  onStep?: (step: string) => void;
}): Promise<RegisterPushResult> {
  const step = (s: string) => opts?.onStep?.(s);

  if (!isPushSupported()) return { status: "unsupported" };
  if (isIOS() && !isStandalone()) return { status: "needs_install" };
  if (!VAPID_PUBLIC_KEY) return { status: "error", error: "Push not configured" };

  try {
    step("Requesting permission…");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { status: "denied" };

    step("Preparing service worker…");
    // The SW is registered app-wide by ServiceWorkerRegistrar, but self-heal in
    // case it hasn't completed yet (or this is the very first launch).
    const existingReg = await navigator.serviceWorker.getRegistration();
    if (!existingReg) {
      await navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {});
    }
    const reg = await withTimeout(
      navigator.serviceWorker.ready,
      10000,
      "Service worker not ready"
    );

    step("Checking subscription…");
    let sub = await withTimeout(
      reg.pushManager.getSubscription(),
      10000,
      "Could not read existing subscription"
    );

    // Drop a stale subscription created against a different VAPID key — otherwise
    // the server signs with a key the push service won't accept (silent failure),
    // and re-subscribing with the same key can hang on iOS.
    if (sub) {
      const existingKey = sub.options?.applicationServerKey;
      const existingKeyB64 = existingKey ? bufToBase64Url(existingKey) : null;
      if (existingKeyB64 && existingKeyB64 !== VAPID_PUBLIC_KEY) {
        step("Updating subscription…");
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }

    if (!sub) {
      step("Subscribing…");
      sub = await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }),
        20000,
        "Subscribe timed out"
      );
    }

    step("Saving…");
    const json = sub.toJSON();
    const controller = new AbortController();
    const saveTimer = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await authedFetch("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          endpoint: json.endpoint,
          p256dh: json.keys?.p256dh,
          auth: json.keys?.auth,
          user_agent: navigator.userAgent,
        }),
        signal: controller.signal,
      });
    } catch (e: any) {
      return {
        status: "error",
        error: e?.name === "AbortError" ? "Saving subscription timed out" : e?.message,
      };
    } finally {
      clearTimeout(saveTimer);
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { status: "error", error: j?.error || `HTTP ${res.status}` };
    }

    return { status: "subscribed" };
  } catch (e: any) {
    return { status: "error", error: e?.message ?? "Failed to enable notifications" };
  }
}

/** Remove the current device's push subscription (best-effort). */
export async function unregisterPush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await authedFetch("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

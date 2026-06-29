"use client";

import { useEffect } from "react";

/**
 * Registers the Workbox-generated service worker (`/sw.js`).
 *
 * next-pwa's own auto-registration injects its register script into the
 * `main.js` webpack entry, which the App Router never loads (it uses
 * `main-app`), so the SW was generated but never registered on devices — and
 * Web Push can't work without an active service worker. We register it
 * ourselves here instead (see next.config.mjs `register: false`).
 *
 * Production only: next-pwa sets `disable: !isProd`, so `/sw.js` doesn't exist
 * in `next dev` and registering it would 404.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.info("[sw] registered", reg.scope);
        // Pick up new deployments without waiting for all tabs to close.
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.error("[sw] registration failed", err);
      });
  }, []);

  return null;
}

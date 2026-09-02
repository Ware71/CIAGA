"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Smartphone } from "lucide-react";
import { usePushPrompt } from "@/lib/notifications/usePushPrompt";
import {
  isIOS,
  isStandalone,
  notificationPermission,
  registerPush,
} from "@/lib/push/clientPush";

type Variant = "default" | "denied" | "ios_install";

function initialVariant(): Variant {
  if (isIOS() && !isStandalone()) return "ios_install";
  if (notificationPermission() === "denied") return "denied";
  return "default";
}

/**
 * Recurring "Allow notifications" prompt shown on the home screen when push
 * isn't enabled and it's been >= 3 months since it was last presented. See
 * usePushPrompt for the cadence logic.
 */
export default function PushPermissionPrompt({
  profileId,
  suppressed,
}: {
  profileId: string | null;
  suppressed: boolean;
}) {
  const { show, dismiss } = usePushPrompt({ profileId, suppressed });
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [working, setWorking] = useState(false);
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    setError(null);
    setStepLabel(null);
    setWorking(true);
    const r = await registerPush({ onStep: setStepLabel });
    setWorking(false);
    if (r.status === "subscribed") dismiss();
    else if (r.status === "denied") setVariant("denied");
    else if (r.status === "needs_install") setVariant("ios_install");
    else if (r.status === "misconfigured")
      setError(
        "Push isn’t set up on this deployment yet. Nothing you can fix from here — it needs the server’s VAPID key."
      );
    else if (r.status === "error") setError(r.error || "Couldn’t enable notifications.");
    // unsupported: leave the modal so the user can dismiss it
  }

  if (typeof document === "undefined") return null;

  // Portalled to <body>: rendered in place it sits inside the home screen's
  // drag-to-Majors container, so gestures over it would reach that handler.
  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[55] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70" onClick={dismiss} />
          <motion.div
            className="relative w-full max-w-sm rounded-3xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] p-5 shadow-2xl"
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-[color:var(--sec-text-2)]">
              {variant === "ios_install" ? <Smartphone size={24} /> : <Bell size={24} />}
            </div>

            {variant === "default" && (
              <>
                <div className="text-xl font-extrabold text-[color:var(--sec-accent)]">Turn on notifications</div>
                <div className="mt-2 text-sm font-medium text-[color:var(--sec-muted)]">
                  Get notified about new events, when entry opens, mentions, and when people you
                  follow tee off.
                </div>
                <div className="mt-5 space-y-2">
                  <button
                    type="button"
                    onClick={enable}
                    disabled={working}
                    className="w-full rounded-full bg-[color:var(--sec-accent)] px-4 py-2.5 text-sm font-extrabold text-[color:var(--ciaga-ground)] disabled:opacity-60"
                  >
                    {working ? stepLabel ?? "Enabling…" : "Enable notifications"}
                  </button>
                  {error && (
                    <div className="text-xs font-medium text-[color:var(--sec-muted)]">
                      {error} Tap to try again.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={dismiss}
                    className="w-full rounded-full px-4 py-2 text-sm font-semibold text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
                  >
                    Not now
                  </button>
                </div>
              </>
            )}

            {variant === "denied" && (
              <>
                <div className="text-xl font-extrabold text-[color:var(--sec-accent)]">Notifications are off</div>
                <div className="mt-2 text-sm font-medium text-[color:var(--sec-muted)]">
                  They’re currently blocked for this site. To turn them on, enable notifications for
                  CIAGA in your browser/site settings, then reopen the app.
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  className="mt-5 w-full rounded-full bg-emerald-400 px-4 py-2.5 text-sm font-extrabold text-[color:var(--ciaga-ground)]"
                >
                  Got it
                </button>
              </>
            )}

            {variant === "ios_install" && (
              <>
                <div className="text-xl font-extrabold text-[color:var(--sec-accent)]">Add CIAGA to your Home Screen</div>
                <div className="mt-2 text-sm font-medium text-[color:var(--sec-muted)]">
                  On iPhone, notifications need the app installed. In Safari tap the{" "}
                  <b>Share</b> icon, then <b>Add to Home Screen</b>, and open CIAGA from there to
                  enable notifications.
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  className="mt-5 w-full rounded-full bg-emerald-400 px-4 py-2.5 text-sm font-extrabold text-[color:var(--ciaga-ground)]"
                >
                  Got it
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

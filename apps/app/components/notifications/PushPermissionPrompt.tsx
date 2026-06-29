"use client";

import { useState } from "react";
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
    else if (r.status === "error") setError(r.error || "Couldn’t enable notifications.");
    // unsupported: leave the modal so the user can dismiss it
  }

  return (
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
            className="relative w-full max-w-sm rounded-3xl border border-emerald-900/60 bg-[#071c10] p-5 shadow-2xl"
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-emerald-200">
              {variant === "ios_install" ? <Smartphone size={24} /> : <Bell size={24} />}
            </div>

            {variant === "default" && (
              <>
                <div className="text-xl font-extrabold text-[#f5e6b0]">Turn on notifications</div>
                <div className="mt-2 text-sm font-medium text-emerald-100/85">
                  Get notified about new events, when entry opens, mentions, and when people you
                  follow tee off.
                </div>
                <div className="mt-5 space-y-2">
                  <button
                    type="button"
                    onClick={enable}
                    disabled={working}
                    className="w-full rounded-full bg-[#f5e6b0] px-4 py-2.5 text-sm font-extrabold text-[#042713] disabled:opacity-60"
                  >
                    {working ? stepLabel ?? "Enabling…" : "Enable notifications"}
                  </button>
                  {error && (
                    <div className="text-xs font-medium text-emerald-100/60">
                      {error} Tap to try again.
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={dismiss}
                    className="w-full rounded-full px-4 py-2 text-sm font-semibold text-emerald-200/70 hover:text-emerald-100"
                  >
                    Not now
                  </button>
                </div>
              </>
            )}

            {variant === "denied" && (
              <>
                <div className="text-xl font-extrabold text-[#f5e6b0]">Notifications are off</div>
                <div className="mt-2 text-sm font-medium text-emerald-100/85">
                  They’re currently blocked for this site. To turn them on, enable notifications for
                  CIAGA in your browser/site settings, then reopen the app.
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  className="mt-5 w-full rounded-full bg-emerald-400 px-4 py-2.5 text-sm font-extrabold text-emerald-950"
                >
                  Got it
                </button>
              </>
            )}

            {variant === "ios_install" && (
              <>
                <div className="text-xl font-extrabold text-[#f5e6b0]">Add CIAGA to your Home Screen</div>
                <div className="mt-2 text-sm font-medium text-emerald-100/85">
                  On iPhone, notifications need the app installed. In Safari tap the{" "}
                  <b>Share</b> icon, then <b>Add to Home Screen</b>, and open CIAGA from there to
                  enable notifications.
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  className="mt-5 w-full rounded-full bg-emerald-400 px-4 py-2.5 text-sm font-extrabold text-emerald-950"
                >
                  Got it
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

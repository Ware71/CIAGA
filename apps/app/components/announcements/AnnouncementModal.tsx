"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Check, MapPin, Smartphone, Sparkles } from "lucide-react";
import type { Announcement } from "@/lib/announcements/useAnnouncements";
import {
  isIOS,
  isStandalone,
  registerPush,
  type RegisterPushResult,
} from "@/lib/push/clientPush";
import { markPushPromptShown } from "@/lib/notifications/usePushPrompt";

type Props = {
  items: Announcement[];
  onSeen: (id: string) => void;
};

/**
 * Shows queued announcements one at a time. The `onboarding` kind renders a
 * multi-step flow (navigation tips + push/location permission priming); other
 * kinds render a single promo/info card. Each is marked seen on dismissal.
 */
export default function AnnouncementModal({ items, onSeen }: Props) {
  const current = items[0];

  if (typeof document === "undefined") return null;

  // Portalled to <body>: rendered in place it sits inside the home screen's
  // drag-to-Majors container, so gestures over it would reach that handler.
  return createPortal(
    <AnimatePresence>
      {current && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70" />
          <motion.div
            key={current.id}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] shadow-2xl"
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
          >
            {current.kind === "onboarding" ? (
              <OnboardingFlow
                ann={current}
                onDone={() => {
                  // Onboarding already asks for push — start the 3-month cooldown
                  // so the dedicated prompt doesn't fire in the same session.
                  markPushPromptShown();
                  onSeen(current.id);
                }}
              />
            ) : (
              <InfoCard ann={current} onDone={() => onSeen(current.id)} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Promo / info card ────────────────────────────────────────────────────────

function InfoCard({ ann, onDone }: { ann: Announcement; onDone: () => void }) {
  const router = useRouter();
  return (
    <div>
      {ann.image_url ? (
        <img src={ann.image_url} alt="" className="h-40 w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="grid h-28 w-full place-items-center bg-[color:var(--sec-surface)]">
          <Sparkles className="text-[color:var(--sec-good)]" size={32} />
        </div>
      )}
      <div className="space-y-3 p-5">
        <div className="text-lg font-extrabold text-[color:var(--sec-accent)]">{ann.title}</div>
        {ann.body ? (
          <div className="whitespace-pre-wrap text-sm font-medium text-[color:var(--sec-muted)]">
            {ann.body}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-4 py-2 text-sm font-semibold text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
          >
            Dismiss
          </button>
          {ann.cta_url ? (
            <button
              type="button"
              onClick={() => {
                onDone();
                const url = ann.cta_url!;
                if (/^https?:\/\//.test(url)) window.open(url, "_blank");
                else router.push(url);
              }}
              className="rounded-full bg-[color:var(--sec-accent)] px-4 py-2 text-sm font-extrabold text-[color:var(--ciaga-ground)] hover:bg-[color:color-mix(in_srgb,var(--sec-accent)_90%,transparent)]"
            >
              {ann.cta_label || "Learn more"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Onboarding flow ──────────────────────────────────────────────────────────

function OnboardingFlow({ ann, onDone }: { ann: Announcement; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [pushStatus, setPushStatus] = useState<RegisterPushResult["status"] | "working" | null>(
    null
  );
  const [pushStep, setPushStep] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [locStatus, setLocStatus] = useState<"working" | "granted" | "denied" | "unsupported" | null>(
    null
  );

  const iosNeedsInstall = isIOS() && !isStandalone();

  async function enablePush() {
    setPushError(null);
    setPushStep(null);
    setPushStatus("working");
    const r = await registerPush({ onStep: setPushStep });
    if (r.status === "error") setPushError(r.error);
    setPushStatus(r.status);
  }

  function enableLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocStatus("unsupported");
      return;
    }
    setLocStatus("working");
    navigator.geolocation.getCurrentPosition(
      () => setLocStatus("granted"),
      () => setLocStatus("denied"),
      { timeout: 10000 }
    );
  }

  const steps = [
    // 0 — welcome / navigation
    <div key="welcome" className="space-y-4">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-[color:var(--sec-text-2)]">
        <Sparkles size={24} />
      </div>
      <div className="text-xl font-extrabold text-[color:var(--sec-accent)]">{ann.title}</div>
      <ul className="space-y-2 text-sm font-medium text-[color:var(--sec-muted)]">
        <li>• Tap <b>New Round</b> on this screen to start playing.</li>
        <li>• <b>Press and hold</b> the logo in the bar below for quick links — they change with the screen you are on.</li>
        <li>• The <b>Social</b> feed shows rounds, records and posts from people you follow.</li>
        <li>• <b>Majors</b> is your hub for groups, events and leaderboards.</li>
        <li>• The <b>bell</b> (top-right) holds your notifications.</li>
      </ul>
    </div>,

    // 1 — notifications
    <div key="push" className="space-y-4">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-[color:var(--sec-text-2)]">
        <Bell size={24} />
      </div>
      <div className="text-xl font-extrabold text-[color:var(--sec-accent)]">Stay in the loop</div>
      <div className="text-sm font-medium text-[color:var(--sec-muted)]">
        Get notified about new events, when entry opens, mentions, and when people you follow play.
      </div>
      {iosNeedsInstall ? (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs font-medium text-amber-100">
          <div className="mb-1 flex items-center gap-2 font-bold">
            <Smartphone size={14} /> Add to Home Screen first
          </div>
          On iPhone, notifications need the app installed: tap the <b>Share</b> icon in Safari,
          then <b>Add to Home Screen</b>, and open CIAGA from there.
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={enablePush}
            disabled={pushStatus === "working" || pushStatus === "subscribed"}
            className="w-full rounded-full bg-[color:var(--sec-accent)] px-4 py-2.5 text-sm font-extrabold text-[color:var(--ciaga-ground)] disabled:opacity-60"
          >
            {pushStatus === "subscribed"
              ? "Notifications enabled ✓"
              : pushStatus === "working"
                ? pushStep ?? "Enabling…"
                : "Enable notifications"}
          </button>
          {pushStatus === "denied" && (
            <div className="text-xs font-medium text-[color:var(--sec-muted)]">
              Permission was blocked — you can enable it later in your browser settings.
            </div>
          )}
          {pushStatus === "unsupported" && (
            <div className="text-xs font-medium text-[color:var(--sec-muted)]">
              Push isn’t supported on this device/browser.
            </div>
          )}
          {pushStatus === "error" && (
            <div className="text-xs font-medium text-[color:var(--sec-muted)]">
              Couldn’t enable notifications{pushError ? `: ${pushError}` : ""}. Tap to try
              again.
            </div>
          )}
        </div>
      )}
    </div>,

    // 2 — location
    <div key="loc" className="space-y-4">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-[color:var(--sec-text-2)]">
        <MapPin size={24} />
      </div>
      <div className="text-xl font-extrabold text-[color:var(--sec-accent)]">Find courses near you</div>
      <div className="text-sm font-medium text-[color:var(--sec-muted)]">
        Allow location so we can find nearby courses and power the rangefinder.
      </div>
      <button
        type="button"
        onClick={enableLocation}
        disabled={locStatus === "working" || locStatus === "granted"}
        className="w-full rounded-full bg-[color:var(--sec-accent)] px-4 py-2.5 text-sm font-extrabold text-[color:var(--ciaga-ground)] disabled:opacity-60"
      >
        {locStatus === "granted"
          ? "Location enabled ✓"
          : locStatus === "working"
            ? "Requesting…"
            : "Enable location"}
      </button>
      {locStatus === "denied" && (
        <div className="text-xs font-medium text-[color:var(--sec-muted)]">
          No problem — you can still search for courses by name.
        </div>
      )}
    </div>,

    // 3 — done
    <div key="done" className="space-y-4">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-[color:var(--sec-text-2)]">
        <Check size={24} />
      </div>
      <div className="text-xl font-extrabold text-[color:var(--sec-accent)]">You’re all set</div>
      <div className="text-sm font-medium text-[color:var(--sec-muted)]">
        Enjoy CIAGA — go play a round and share it with your group.
      </div>
    </div>,
  ];

  const isLast = step === steps.length - 1;

  return (
    <div className="p-5">
      <div className="min-h-[220px]">{steps[step]}</div>

      {/* progress dots */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {steps.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === step ? "w-5 bg-emerald-400" : "w-1.5 bg-[color:var(--sec-surface-2)]"
            }`}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onDone}
          className="text-sm font-semibold text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => (isLast ? onDone() : setStep((s) => s + 1))}
          className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-extrabold text-[color:var(--ciaga-ground)] hover:bg-emerald-300"
        >
          {isLast ? "Get started" : "Next"}
        </button>
      </div>
    </div>
  );
}

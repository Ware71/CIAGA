"use client";

import { useState } from "react";
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

  return (
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
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-emerald-900/60 bg-[#071c10] shadow-2xl"
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
    </AnimatePresence>
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
        <div className="grid h-28 w-full place-items-center bg-emerald-900/30">
          <Sparkles className="text-emerald-300" size={32} />
        </div>
      )}
      <div className="space-y-3 p-5">
        <div className="text-lg font-extrabold text-[#f5e6b0]">{ann.title}</div>
        {ann.body ? (
          <div className="whitespace-pre-wrap text-sm font-medium text-emerald-100/85">
            {ann.body}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-4 py-2 text-sm font-semibold text-emerald-200/70 hover:text-emerald-100"
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
              className="rounded-full bg-[#f5e6b0] px-4 py-2 text-sm font-extrabold text-[#042713] hover:bg-[#f5e6b0]/90"
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
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-emerald-200">
        <Sparkles size={24} />
      </div>
      <div className="text-xl font-extrabold text-[#f5e6b0]">{ann.title}</div>
      <ul className="space-y-2 text-sm font-medium text-emerald-100/85">
        <li>• Tap the menu to start a <b>New Round</b>, view <b>Stats</b> or browse <b>Courses</b>.</li>
        <li>• The <b>Social</b> feed shows rounds, records and posts from people you follow.</li>
        <li>• <b>Majors</b> is your hub for groups, events and leaderboards.</li>
        <li>• The <b>bell</b> (top-right) holds your notifications.</li>
      </ul>
    </div>,

    // 1 — notifications
    <div key="push" className="space-y-4">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-emerald-200">
        <Bell size={24} />
      </div>
      <div className="text-xl font-extrabold text-[#f5e6b0]">Stay in the loop</div>
      <div className="text-sm font-medium text-emerald-100/85">
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
            className="w-full rounded-full bg-[#f5e6b0] px-4 py-2.5 text-sm font-extrabold text-[#042713] disabled:opacity-60"
          >
            {pushStatus === "subscribed"
              ? "Notifications enabled ✓"
              : pushStatus === "working"
                ? pushStep ?? "Enabling…"
                : "Enable notifications"}
          </button>
          {pushStatus === "denied" && (
            <div className="text-xs font-medium text-emerald-100/60">
              Permission was blocked — you can enable it later in your browser settings.
            </div>
          )}
          {pushStatus === "unsupported" && (
            <div className="text-xs font-medium text-emerald-100/60">
              Push isn’t supported on this device/browser.
            </div>
          )}
          {pushStatus === "error" && (
            <div className="text-xs font-medium text-emerald-100/60">
              Couldn’t enable notifications{pushError ? `: ${pushError}` : ""}. Tap to try
              again.
            </div>
          )}
        </div>
      )}
    </div>,

    // 2 — location
    <div key="loc" className="space-y-4">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-emerald-200">
        <MapPin size={24} />
      </div>
      <div className="text-xl font-extrabold text-[#f5e6b0]">Find courses near you</div>
      <div className="text-sm font-medium text-emerald-100/85">
        Allow location so we can find nearby courses and power the rangefinder.
      </div>
      <button
        type="button"
        onClick={enableLocation}
        disabled={locStatus === "working" || locStatus === "granted"}
        className="w-full rounded-full bg-[#f5e6b0] px-4 py-2.5 text-sm font-extrabold text-[#042713] disabled:opacity-60"
      >
        {locStatus === "granted"
          ? "Location enabled ✓"
          : locStatus === "working"
            ? "Requesting…"
            : "Enable location"}
      </button>
      {locStatus === "denied" && (
        <div className="text-xs font-medium text-emerald-100/60">
          No problem — you can still search for courses by name.
        </div>
      )}
    </div>,

    // 3 — done
    <div key="done" className="space-y-4">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/20 text-emerald-200">
        <Check size={24} />
      </div>
      <div className="text-xl font-extrabold text-[#f5e6b0]">You’re all set</div>
      <div className="text-sm font-medium text-emerald-100/85">
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
              i === step ? "w-5 bg-emerald-400" : "w-1.5 bg-emerald-800/70"
            }`}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onDone}
          className="text-sm font-semibold text-emerald-200/60 hover:text-emerald-100"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => (isLast ? onDone() : setStep((s) => s + 1))}
          className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-extrabold text-emerald-950 hover:bg-emerald-300"
        >
          {isLast ? "Get started" : "Next"}
        </button>
      </div>
    </div>
  );
}

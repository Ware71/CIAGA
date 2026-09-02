"use client";

import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { NOTIFICATION_CATEGORIES } from "@/lib/notifications/preferences";
import { useNotificationPreferences } from "@/lib/notifications/useNotificationPreferences";
import {
  getPushDeliveryState,
  isIOS,
  isStandalone,
  notificationPermission,
  registerPush,
  unregisterPush,
} from "@/lib/push/clientPush";
import { Group } from "@/components/ui/chrome";

/**
 * Push settings: the master switch for this device, then a mute switch per
 * category.
 *
 * Lifted out of NotificationCenter so /more/settings and the bell's cog render
 * the same thing rather than drifting apart, and restyled onto the chrome
 * primitives — it was the last screen still building its own boxed cards.
 *
 * Muting silences the DEVICE only. The notification is still written, still
 * appears in the list, and still counts as unread.
 */
export function Toggle({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        on ? "bg-[color:var(--sec-accent)]" : "bg-[color:var(--sec-surface-2)]"
      }`}
    >
      {/* left-0 is required: without an explicit inset the knob is positioned
          from its STATIC position, and a button's default text-align:center
          (which Tailwind preflight does not reset) pushed it off-centre. */}
      <span
        className={`absolute left-0 top-[3px] h-5 w-5 rounded-full transition-transform ${
          on
            ? "translate-x-[21px] bg-[color:var(--ciaga-ground)]"
            : "translate-x-[3px] bg-[color:var(--sec-muted)]"
        }`}
      />
    </button>
  );
}

/** One switch row — title over an explanation, switch pinned right. */
function SwitchRow({
  title,
  detail,
  tone,
  on,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  tone?: "warn";
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex min-h-[var(--row-h)] items-center gap-3 border-b border-[color:var(--hair)] py-[var(--row-pv)] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[length:var(--t-body)] text-[color:var(--sec-text)]">{title}</div>
        <div
          className={`mt-[2px] text-[length:var(--t-sec)] ${
            tone === "warn" ? "text-amber-300" : "text-[color:var(--sec-muted)]"
          }`}
        >
          {detail}
        </div>
      </div>
      <Toggle on={on} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

export function NotificationSettings({ profileId }: { profileId: string | null }) {
  const { muted, loading, toggle } = useNotificationPreferences(profileId);

  // Permission is device-local, but it is NOT proof of delivery: it stays
  // "granted" after the server prunes a dead subscription. Delivery state is
  // checked separately so the toggle can't claim push works when it doesn't.
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default"
  );
  const [delivery, setDelivery] = useState<"delivering" | "not_registered" | "unknown">(
    "unknown"
  );
  const [needsInstall, setNeedsInstall] = useState(false);
  const [working, setWorking] = useState(false);
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const perm = notificationPermission();
    setPermission(perm);
    setNeedsInstall(isIOS() && !isStandalone());
    if (perm !== "granted") return;
    let cancelled = false;
    void getPushDeliveryState().then((s) => {
      if (!cancelled) setDelivery(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pushOn = permission === "granted";
  // Permission granted but the server can't reach this device — the case that
  // silently swallowed pushes while the pane insisted they were on.
  const needsRepair = pushOn && delivery === "not_registered";

  async function togglePush() {
    setError(null);
    setWorking(true);
    if (pushOn && !needsRepair) {
      await unregisterPush();
      // Permission itself can only be revoked in browser settings; dropping the
      // subscription is what actually stops delivery.
      setPermission(notificationPermission());
      setDelivery("not_registered");
      setWorking(false);
      return;
    }
    const r = await registerPush({ onStep: setStepLabel });
    setWorking(false);
    setStepLabel(null);
    if (r.status === "subscribed") {
      setPermission("granted");
      setDelivery("delivering");
    } else if (r.status === "denied") setPermission("denied");
    else if (r.status === "needs_install") setNeedsInstall(true);
    else if (r.status === "misconfigured") {
      setError(
        "Push isn’t set up on this deployment (the server is missing its VAPID key). This needs fixing in the app’s environment settings — it isn’t something you can turn on here."
      );
      setDelivery("not_registered");
    } else if (r.status === "error") setError(r.error || "Couldn’t enable notifications.");
    else if (r.status === "unsupported") setPermission("unsupported");
  }

  return (
    <>
      <Group label="This device">
        {needsInstall ? (
          <div className="flex items-start gap-3 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400/15 text-amber-300">
              <Smartphone size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[length:var(--t-body)] text-[color:var(--sec-text)]">
                Add CIAGA to your Home Screen
              </div>
              <div className="mt-[2px] text-[length:var(--t-sec)] leading-relaxed text-[color:var(--sec-muted)]">
                On iPhone, push needs the app installed. Tap <b>Share</b> → <b>Add to Home
                Screen</b>, then open CIAGA from there.
              </div>
            </div>
          </div>
        ) : permission === "unsupported" ? (
          <div className="py-3 text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
            This browser doesn’t support push notifications.
          </div>
        ) : permission === "denied" ? (
          <div className="py-3 text-[length:var(--t-sec)] leading-relaxed text-[color:var(--sec-muted)]">
            Notifications are blocked for this site. Enable them for CIAGA in your browser’s
            site settings, then reopen the app.
          </div>
        ) : (
          <SwitchRow
            title="Push notifications"
            tone={needsRepair && !working ? "warn" : undefined}
            detail={
              working
                ? stepLabel ?? "Working…"
                : needsRepair
                  ? "Not registered on this device — turn on to start receiving alerts again"
                  : pushOn
                    ? "Alerts are delivered to this device"
                    : "Turn on to get alerts on this device"
            }
            on={pushOn && !needsRepair}
            disabled={working}
            onChange={() => void togglePush()}
          />
        )}
        {error ? (
          <div className="py-2 text-[length:var(--t-sec)] text-[color:var(--sec-bad)]">{error}</div>
        ) : null}
      </Group>

      <Group label="What buzzes">
        {NOTIFICATION_CATEGORIES.map((c) => (
          <SwitchRow
            key={c.key}
            title={c.label}
            detail={c.description}
            on={!muted.has(c.key)}
            disabled={loading || !profileId}
            onChange={() => void toggle(c.key)}
          />
        ))}
      </Group>

      <p className="pb-2 text-[length:var(--t-sec)] leading-relaxed text-[color:var(--sec-muted)]">
        Muted alerts still appear in your notifications — you just won’t get a push.
      </p>
    </>
  );
}

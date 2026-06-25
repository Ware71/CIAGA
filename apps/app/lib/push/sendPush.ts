import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Server-side Web Push sender. Loads VAPID config lazily so the rest of the app
 * keeps working (in-app notifications still get inserted) even if push keys are
 * not configured in a given environment.
 */

let configured = false;
let configuredOk = false;

function ensureConfigured(): boolean {
  if (configured) return configuredOk;
  configured = true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@ciaga.golf";

  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys not set — skipping push delivery");
    configuredOk = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configuredOk = true;
  return true;
}

export type PushMessage = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  /** Coalesce notifications on the device (e.g. one per grouped key). */
  tag?: string;
};

/**
 * Send a push message to every active subscription owned by the given profiles.
 * Dead subscriptions (404/410) are pruned. Best-effort: never throws.
 */
export async function sendPushToProfiles(
  profileIds: string[],
  message: PushMessage
): Promise<void> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  if (ids.length === 0) return;
  if (!ensureConfigured()) return;

  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("profile_id", ids);

  if (error || !subs || subs.length === 0) return;

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url ?? "/home",
    icon: message.icon,
    tag: message.tag,
  });

  const deadIds: string[] = [];

  await Promise.allSettled(
    (subs as any[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) deadIds.push(s.id);
      }
    })
  );

  if (deadIds.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", deadIds);
  }
}

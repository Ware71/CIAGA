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

/** Which VAPID env vars are missing — for diagnostics when unconfigured. */
function missingVapidEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) missing.push("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  if (!process.env.VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
  return missing;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "(invalid endpoint)";
  }
}

export type PushMessage = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  /** Coalesce notifications on the device (e.g. one per grouped key). */
  tag?: string;
  /** Recipient's current unread count — set on the app icon by the SW. */
  badgeCount?: number;
};

/** Per-subscription outcome of a push send. */
export type PushSubResult = {
  host: string;
  statusCode?: number;
  ok: boolean;
  /** Push-service response body (e.g. Apple's rejection reason) on failure. */
  body?: string;
  /** True when the subscription was pruned as dead (404/410). */
  pruned?: boolean;
};

/** Summary of a push send, used for logging and the admin diagnostics endpoint. */
export type PushSendResult = {
  configured: boolean;
  /** Present when configured is false: which VAPID env vars are missing. */
  missingEnv?: string[];
  total: number;
  sent: number;
  failed: number;
  results: PushSubResult[];
};

/**
 * Send a push message to every active subscription owned by the given profiles.
 * Dead subscriptions (404/410) are pruned. Best-effort: never throws. Returns a
 * summary of what happened so callers (and the admin diagnostics endpoint) can
 * see *why* a send failed — Apple/FCM rejections are otherwise invisible.
 */
export async function sendPushToProfiles(
  profileIds: string[],
  message: PushMessage
): Promise<PushSendResult> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  if (ids.length === 0) {
    return { configured: true, total: 0, sent: 0, failed: 0, results: [] };
  }

  if (!ensureConfigured()) {
    const missingEnv = missingVapidEnv();
    console.warn(
      `[push] not configured — skipping send (missing: ${missingEnv.join(", ") || "?"})`
    );
    return { configured: false, missingEnv, total: 0, sent: 0, failed: 0, results: [] };
  }

  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("profile_id", ids);

  if (error) {
    console.error("[push] failed to load subscriptions:", error.message);
    return { configured: true, total: 0, sent: 0, failed: 0, results: [] };
  }
  if (!subs || subs.length === 0) {
    return { configured: true, total: 0, sent: 0, failed: 0, results: [] };
  }

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url ?? "/home",
    icon: message.icon,
    tag: message.tag,
    badgeCount: message.badgeCount,
  });

  const deadIds: string[] = [];

  const settled = await Promise.all(
    (subs as any[]).map(async (s): Promise<PushSubResult> => {
      const host = hostOf(s.endpoint);
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        return { host, statusCode: 201, ok: true };
      } catch (e: any) {
        const statusCode: number | undefined = e?.statusCode;
        const body: string | undefined =
          (typeof e?.body === "string" && e.body) || e?.message || undefined;

        if (statusCode === 404 || statusCode === 410) {
          deadIds.push(s.id);
          console.warn(`[push] pruning dead subscription (${statusCode}) host=${host}`);
          return { host, statusCode, ok: false, pruned: true, body };
        }

        // Any other failure (403 key mismatch, 400 bad JWT, 401, 413, network…)
        // was previously swallowed silently. Log it so it can be diagnosed.
        console.error(
          `[push] send failed host=${host} status=${statusCode ?? "?"} body=${body ?? "(none)"}`
        );
        return { host, statusCode, ok: false, body };
      }
    })
  );

  if (deadIds.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", deadIds);
  }

  const sent = settled.filter((r) => r.ok).length;
  return {
    configured: true,
    total: settled.length,
    sent,
    failed: settled.length - sent,
    results: settled,
  };
}

import { NextResponse } from "next/server";
import { requireAdminProfile, adminErrorStatus } from "@/lib/auth/requireAdmin";
import { sendPushToProfiles } from "@/lib/push/sendPush";

export const runtime = "nodejs";

// POST /api/admin/push-test — send a Web Push to the calling admin's own device
// subscriptions and return the full per-subscription result. Lets the admin tap
// once on their installed PWA and see exactly why push fails (e.g. a 403 VAPID
// key mismatch from Apple) instead of it silently doing nothing.
export async function POST(req: Request) {
  try {
    const { adminProfileId } = await requireAdminProfile(req);

    const result = await sendPushToProfiles([adminProfileId], {
      title: "CIAGA test notification",
      body: `Push diagnostics — ${new Date().toLocaleTimeString()}`,
      url: "/home",
      tag: "push-test",
    });

    return NextResponse.json(result);
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}

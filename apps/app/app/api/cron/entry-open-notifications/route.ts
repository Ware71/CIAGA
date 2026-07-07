import { NextResponse } from "next/server";
import { runEntryOpenNotifications } from "@/lib/notifications/entryOpenSweep";
import { safeCompare } from "@/lib/auth/safeCompare";

export const runtime = "nodejs";

/**
 * GET /api/cron/entry-open-notifications
 *
 * Manual / on-demand entry-open sweep. NOT scheduled in vercel.json — on the
 * Vercel Hobby plan crons may only run once per day, so the sweep is invoked
 * from the daily auto-complete-rounds cron instead (see runEntryOpenNotifications).
 * This route remains for manual triggering and testing.
 *
 * Secured with CRON_SECRET (Vercel sends "Authorization: Bearer <CRON_SECRET>").
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[entry-open-notifications] CRON_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (!safeCompare(req.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runEntryOpenNotifications();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[entry-open-notifications] error:", e?.message);
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { runEntryOpenNotifications } from "@/lib/notifications/entryOpenSweep";
import { runEntryClosingNotifications } from "@/lib/notifications/entryClosingSweep";
import { safeCompare } from "@/lib/auth/safeCompare";

export const runtime = "nodejs";

/**
 * GET /api/cron/entry-open-notifications
 *
 * Manual / on-demand entry-window sweeps (entry opened, and entry closing
 * today). NOT scheduled in vercel.json — on the Vercel Hobby plan crons may only
 * run once per day, so both sweeps are invoked from the daily
 * auto-complete-rounds cron instead. This route remains for manual triggering
 * and testing.
 *
 * Secured with CRON_SECRET (Vercel sends "Authorization: Bearer <CRON_SECRET>").
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[entry-notifications] CRON_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (!safeCompare(req.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Sequential: both write to events, and a manual run is never hot.
    const entryOpen = await runEntryOpenNotifications();
    const entryClosing = await runEntryClosingNotifications();
    return NextResponse.json({ ok: true, entryOpen, entryClosing });
  } catch (e: any) {
    console.error("[entry-notifications] error:", e?.message);
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

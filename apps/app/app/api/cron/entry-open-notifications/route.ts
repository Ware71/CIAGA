import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotificationsForMany } from "@/lib/notifications/notify";

export const runtime = "nodejs";

/**
 * GET /api/cron/entry-open-notifications
 *
 * Called by Vercel Cron. Finds events whose entry window has just opened
 * (entry_window_start <= now) but which have not yet had an entry-open
 * notification sent (entry_open_notified_at IS NULL), and notifies active
 * group members. Stamps entry_open_notified_at so each event fires once.
 *
 * Secured with CRON_SECRET (Vercel sends "Authorization: Bearer <CRON_SECRET>").
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[entry-open-notifications] CRON_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const nowIso = new Date().toISOString();

  const { data: events, error } = await supabaseAdmin
    .from("events")
    .select("id, name, group_id, entry_window_end, group:major_groups(name)")
    .is("entry_open_notified_at", null)
    .not("entry_window_start", "is", null)
    .lte("entry_window_start", nowIso)
    .not("group_id", "is", null)
    .not("majors_status", "in", "(completed,cancelled)")
    .limit(200);

  if (error) {
    console.error("[entry-open-notifications] query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let notified = 0;

  for (const evt of (events ?? []) as any[]) {
    try {
      const { data: members } = await supabaseAdmin
        .from("major_group_memberships")
        .select("profile_id")
        .eq("group_id", evt.group_id)
        .eq("status", "active");

      const recipientIds = (members ?? [])
        .map((m: any) => m.profile_id)
        .filter(Boolean) as string[];

      if (recipientIds.length > 0) {
        await createNotificationsForMany(recipientIds, "entry_open", {
          event_id: evt.id,
          event_name: evt.name,
          group_id: evt.group_id,
          group_name: evt.group?.name ?? null,
          entry_window_end: evt.entry_window_end ?? null,
        });
      }

      await supabaseAdmin
        .from("events")
        .update({ entry_open_notified_at: nowIso })
        .eq("id", evt.id);

      notified++;
    } catch (e: any) {
      console.error(`[entry-open-notifications] failed for event ${evt.id}:`, e?.message);
    }
  }

  return NextResponse.json({ ok: true, processed: events?.length ?? 0, notified });
}

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotificationsForMany } from "@/lib/notifications/notify";

/**
 * Finds events whose entry window has opened (entry_window_start <= now) but
 * which haven't had an entry-open notification sent yet, notifies active group
 * members, and stamps entry_open_notified_at so each event fires once.
 *
 * Runs daily — invoked from the auto-complete-rounds cron (a single daily cron
 * keeps us within Vercel Hobby's once-per-day cron limit) and also available via
 * the standalone /api/cron/entry-open-notifications route for manual runs.
 */
export async function runEntryOpenNotifications(): Promise<{
  processed: number;
  notified: number;
}> {
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

  if (error) throw new Error(error.message);

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
      console.error(`[entry-open] failed for event ${evt.id}:`, e?.message);
    }
  }

  return { processed: events?.length ?? 0, notified };
}

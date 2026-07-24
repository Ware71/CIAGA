import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createNotificationsForMany } from "@/lib/notifications/notify";
import { APP_TIME_ZONE } from "@/lib/notifications/render";

/**
 * Finds events whose entry window closes later TODAY (UK local time), nudges the
 * active group members who haven't entered yet, and stamps
 * entry_closing_notified_at so each event fires once.
 *
 * Runs from the daily cron alongside the entry-open sweep. Windows that close
 * before the cron fires are skipped by design — there is no useful warning to
 * give once entry has already shut.
 */

/** Europe/London's UTC offset in ms at the given instant (+1h BST, 0 GMT). */
function ukOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  // Compare against whole seconds — formatToParts has no ms component.
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant "today" ends in UK local time. Pinned to Europe/London rather
 * than the server clock because Vercel Node runs in UTC, so during BST a naive
 * end-of-day would cut an hour short.
 */
export function endOfUkDay(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "2026-07-24"
  const asIfUtc = new Date(`${ymd}T23:59:59.999Z`);
  return new Date(asIfUtc.getTime() - ukOffsetMs(asIfUtc));
}

export async function runEntryClosingNotifications(): Promise<{
  processed: number;
  notified: number;
}> {
  const now = new Date();
  const nowIso = now.toISOString();
  const endOfDayIso = endOfUkDay(now).toISOString();

  const { data: events, error } = await supabaseAdmin
    .from("events")
    .select("id, name, group_id, entry_window_end, group:major_groups(name)")
    .is("entry_closing_notified_at", null)
    .not("entry_window_end", "is", null)
    .gt("entry_window_end", nowIso)
    .lte("entry_window_end", endOfDayIso)
    .not("group_id", "is", null)
    .not("majors_status", "in", "(completed,cancelled)")
    .limit(200);

  if (error) throw new Error(error.message);

  let notified = 0;

  for (const evt of (events ?? []) as any[]) {
    try {
      const [{ data: members }, { data: entries }] = await Promise.all([
        supabaseAdmin
          .from("major_group_memberships")
          .select("profile_id")
          .eq("group_id", evt.group_id)
          .eq("status", "active"),
        supabaseAdmin.from("event_entries").select("profile_id").eq("event_id", evt.id),
      ]);

      // Anyone already in doesn't need a last-chance nudge.
      const entered = new Set(
        (entries ?? []).map((e: any) => e.profile_id).filter(Boolean) as string[]
      );

      const recipientIds = (members ?? [])
        .map((m: any) => m.profile_id)
        .filter((id: string | null) => !!id && !entered.has(id)) as string[];

      if (recipientIds.length > 0) {
        await createNotificationsForMany(recipientIds, "entry_closing", {
          event_id: evt.id,
          event_name: evt.name,
          group_id: evt.group_id,
          group_name: evt.group?.name ?? null,
          entry_window_end: evt.entry_window_end ?? null,
        });
      }

      // Stamp regardless of recipient count — otherwise an event where everyone
      // has already entered stays a candidate and re-fires on a later run.
      await supabaseAdmin
        .from("events")
        .update({ entry_closing_notified_at: nowIso })
        .eq("id", evt.id);

      notified++;
    } catch (e: any) {
      console.error(`[entry-closing] failed for event ${evt.id}:`, e?.message);
    }
  }

  return { processed: events?.length ?? 0, notified };
}

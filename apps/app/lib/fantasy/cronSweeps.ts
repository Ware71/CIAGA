import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateEventFantasy } from "@/lib/fantasy/odds";
import { settleFantasyEvent } from "@/lib/fantasy/settlement";

/**
 * Fantasy sweeps run from the single daily cron (Vercel Hobby limit — see
 * /api/cron/auto-complete-rounds). Everything here is best-effort: failures
 * are logged per event and never abort the cron.
 *
 * Sweeps:
 *  1. Pre-event generation — today's events in fantasy-enabled groups that
 *     have no fantasy_event_state yet. (Events created after the 03:00 run
 *     are covered by admin/first-viewer generation instead.)
 *  2. Settlement safety net — completed events whose fantasy is not final
 *     (the primary path is the reconcileEventStatus hook).
 *  3. Hygiene — fail refresh jobs wedged in 'running' for over 10 minutes
 *     and expire stale cash-out offers (expiry is otherwise enforced by
 *     query filters + the accept RPC; this just tidies the rows).
 */
export async function runFantasySweeps(): Promise<{
  generated: number;
  settled: number;
  failedJobs: number;
  expiredOffers: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let generated = 0;
  let settled = 0;

  const today = new Date().toISOString().slice(0, 10);
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from("events")
    .select("id, group_id, major_groups!inner(fantasy_config)")
    .eq("event_date", today)
    .not("majors_status", "in", '("completed","cancelled")')
    .not("major_groups.fantasy_config", "is", null);

  if (candErr) {
    errors.push(`candidates: ${candErr.message}`);
  } else {
    for (const evt of (candidates ?? []) as { id: string }[]) {
      const { data: state } = await supabaseAdmin
        .from("fantasy_event_state")
        .select("event_id")
        .eq("event_id", evt.id)
        .maybeSingle();
      if (state) continue;
      try {
        await generateEventFantasy(evt.id);
        generated += 1;
      } catch (e: any) {
        errors.push(`generate ${evt.id}: ${e?.message}`);
      }
    }
  }

  // Settlement safety net: completed events whose fantasy never settled.
  const { data: unsettled, error: unsettledErr } = await supabaseAdmin
    .from("fantasy_event_state")
    .select("event_id, events!inner(majors_status)")
    .eq("is_final", false)
    .eq("events.majors_status", "completed");
  if (unsettledErr) {
    errors.push(`settlement: ${unsettledErr.message}`);
  } else {
    for (const row of (unsettled ?? []) as { event_id: string }[]) {
      try {
        const result = await settleFantasyEvent(row.event_id);
        if (result.settled) settled += 1;
      } catch (e: any) {
        errors.push(`settle ${row.event_id}: ${e?.message}`);
      }
    }
  }

  const { data: wedged, error: wedgedErr } = await supabaseAdmin
    .from("fantasy_refresh_jobs")
    .update({
      status: "failed",
      last_error: "timed out (cron hygiene sweep)",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("locked_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .select("id");
  if (wedgedErr) errors.push(`hygiene: ${wedgedErr.message}`);

  const { data: expired, error: expiredErr } = await supabaseAdmin
    .from("fantasy_cashout_offers")
    .update({ status: "expired" })
    .eq("status", "offered")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (expiredErr) errors.push(`offer expiry: ${expiredErr.message}`);

  return {
    generated,
    settled,
    failedJobs: wedged?.length ?? 0,
    expiredOffers: expired?.length ?? 0,
    errors,
  };
}

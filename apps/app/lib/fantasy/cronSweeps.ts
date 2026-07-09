import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateEventFantasy } from "@/lib/fantasy/odds";
import { settleFantasyEvent, settleFantasyRoundMarkets } from "@/lib/fantasy/settlement";

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
 *  4. Retention — free-tier disk control (Supabase Free: 500 MB). Superseded
 *     odds snapshots are the only unbounded growth in the feature; dead jobs
 *     and dead offers are pruned alongside. Snapshots referenced by a pick
 *     and accepted offers are kept for the audit trail.
 */

const SNAPSHOT_RETENTION_DAYS = 7;
const JOB_RETENTION_DAYS = 7;
const OFFER_RETENTION_DAYS = 30;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function runFantasySweeps(): Promise<{
  generated: number;
  settled: number;
  failedJobs: number;
  expiredOffers: number;
  purgedSnapshots: number;
  purgedJobs: number;
  purgedOffers: number;
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

  // Round-market safety net: live multi-round events with completed rounds.
  const { data: liveMulti, error: liveMultiErr } = await supabaseAdmin
    .from("fantasy_event_state")
    .select("event_id, events!inner(majors_status, num_rounds)")
    .eq("is_final", false)
    .eq("events.majors_status", "live")
    .gt("events.num_rounds", 1);
  if (liveMultiErr) {
    errors.push(`round settlement: ${liveMultiErr.message}`);
  } else {
    for (const row of (liveMulti ?? []) as { event_id: string }[]) {
      try {
        await settleFantasyRoundMarkets(row.event_id);
      } catch (e: any) {
        errors.push(`settle rounds ${row.event_id}: ${e?.message}`);
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

  // Retention: purge superseded snapshots older than the window, keeping any
  // a pick still references (fantasy_picks.odds_snapshot_id is ON DELETE SET
  // NULL, so even a miss is safe — the exclusion just preserves audit links).
  let purgedSnapshots = 0;
  try {
    const [{ data: refRows }, { data: legRefRows }] = await Promise.all([
      supabaseAdmin
        .from("fantasy_picks")
        .select("odds_snapshot_id")
        .not("odds_snapshot_id", "is", null),
      supabaseAdmin
        .from("fantasy_parlay_legs")
        .select("odds_snapshot_id")
        .not("odds_snapshot_id", "is", null),
    ]);
    const referenced = [
      ...new Set(
        [...((refRows ?? []) as { odds_snapshot_id: string }[]),
         ...((legRefRows ?? []) as { odds_snapshot_id: string }[])].map(
          (r) => r.odds_snapshot_id
        )
      ),
    ];

    let query = supabaseAdmin
      .from("fantasy_odds_snapshots")
      .delete()
      .eq("status", "superseded")
      .lt("computed_at", daysAgoIso(SNAPSHOT_RETENTION_DAYS));
    // PostgREST `not in` has URL-length limits; picks are human-scale but cap
    // defensively and fall back to keeping everything referenced recently.
    if (referenced.length > 0 && referenced.length <= 500) {
      query = query.not("id", "in", `(${referenced.join(",")})`);
    }
    const { data: purged, error: purgeErr } = await query.select("id");
    if (purgeErr) errors.push(`snapshot retention: ${purgeErr.message}`);
    purgedSnapshots = purged?.length ?? 0;
  } catch (e: any) {
    errors.push(`snapshot retention: ${e?.message}`);
  }

  const { data: purgedJobRows, error: purgeJobsErr } = await supabaseAdmin
    .from("fantasy_refresh_jobs")
    .delete()
    .in("status", ["done", "failed"])
    .lt("updated_at", daysAgoIso(JOB_RETENTION_DAYS))
    .select("id");
  if (purgeJobsErr) errors.push(`job retention: ${purgeJobsErr.message}`);

  const { data: purgedOfferRows, error: purgeOffersErr } = await supabaseAdmin
    .from("fantasy_cashout_offers")
    .delete()
    .in("status", ["expired", "invalidated", "rejected"])
    .lt("created_at", daysAgoIso(OFFER_RETENTION_DAYS))
    .select("id");
  if (purgeOffersErr) errors.push(`offer retention: ${purgeOffersErr.message}`);

  return {
    generated,
    settled,
    failedJobs: wedged?.length ?? 0,
    expiredOffers: expired?.length ?? 0,
    purgedSnapshots,
    purgedJobs: purgedJobRows?.length ?? 0,
    purgedOffers: purgedOfferRows?.length ?? 0,
    errors,
  };
}

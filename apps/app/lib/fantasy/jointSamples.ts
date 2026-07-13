import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";
import {
  decodeBundleRow,
  encodeBundleColumns,
  type JointBundle,
  type JointSampleRow,
} from "@/lib/fantasy/simulation/jointBundle";

/**
 * Persist / load the simulation's per-iteration joint samples (positions plus
 * birdie/eagle counts and gross/net totals) so correlated accas — including
 * cross-family combos like win × 2+ birdies — price from the true joint
 * distribution. One active row per (event, version); older versions are
 * deleted on write (the bundle is a pure pricing cache nothing references, and
 * the extended columns are big enough that keeping superseded rows around for
 * the cron purge would strain the free-tier quota). The cron purge remains as
 * a backstop for rows orphaned by races.
 */

const BUNDLE_COLUMNS =
  "player_ids, sim_count, matrix_b64, birdies_b64, eagles_b64, gross_totals_b64, net_totals_b64, round_totals, event_version";

export async function writeJointSamples(
  eventId: string,
  groupId: string,
  version: number,
  sim: SimulationResult
): Promise<void> {
  const columns = encodeBundleColumns(sim);
  if (!columns) return;
  const playerIds = sim.players.map((p) => p.profileId);

  const { error } = await supabaseAdmin.from("fantasy_joint_samples").upsert(
    {
      event_id: eventId,
      event_version: version,
      group_id: groupId,
      player_ids: playerIds,
      sim_count: sim.simulationCount,
      ...columns,
      status: "active",
    },
    { onConflict: "event_id,event_version" }
  );
  if (error) throw error;

  await supabaseAdmin
    .from("fantasy_joint_samples")
    .delete()
    .eq("event_id", eventId)
    .lt("event_version", version);
}

/** The active joint bundle for an event, or null when none has been written. */
export async function loadJointMatrix(eventId: string): Promise<JointBundle | null> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_joint_samples")
    .select(BUNDLE_COLUMNS)
    .eq("event_id", eventId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return decodeBundleRow(data as unknown as JointSampleRow);
}

/** Active bundles for several events at once (cross-event acca pricing). */
export async function loadJointMatrices(eventIds: string[]): Promise<Map<string, JointBundle>> {
  const out = new Map<string, JointBundle>();
  if (eventIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("fantasy_joint_samples")
    .select(`event_id, ${BUNDLE_COLUMNS}`)
    .in("event_id", eventIds)
    .eq("status", "active");
  if (error) throw error;
  for (const row of (data ?? []) as unknown as (JointSampleRow & { event_id: string })[]) {
    out.set(row.event_id, decodeBundleRow(row));
  }
  return out;
}

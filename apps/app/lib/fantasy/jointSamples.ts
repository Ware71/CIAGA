import { gzipSync, gunzipSync } from "zlib";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";
import type { JointMatrix } from "@/lib/fantasy/simulation/jointPricing";

/**
 * Persist / load the simulation's per-iteration finishing-position matrix so
 * correlated accas can be priced from the true joint distribution. One active
 * row per (event, version); older versions are superseded (cron purges them).
 * The Int8 matrix is gzipped and base64-encoded — reliable through PostgREST
 * and tiny after compression (positions are small integers).
 */
export async function writeJointSamples(
  eventId: string,
  groupId: string,
  version: number,
  sim: SimulationResult
): Promise<void> {
  if (!sim.positions) return;
  const playerIds = sim.players.map((p) => p.profileId);
  const buf = Buffer.from(sim.positions.buffer, sim.positions.byteOffset, sim.positions.byteLength);
  const matrixB64 = gzipSync(buf).toString("base64");

  const { error } = await supabaseAdmin.from("fantasy_joint_samples").upsert(
    {
      event_id: eventId,
      event_version: version,
      group_id: groupId,
      player_ids: playerIds,
      sim_count: sim.simulationCount,
      matrix_b64: matrixB64,
      status: "active",
    },
    { onConflict: "event_id,event_version" }
  );
  if (error) throw error;

  await supabaseAdmin
    .from("fantasy_joint_samples")
    .update({ status: "superseded" })
    .eq("event_id", eventId)
    .lt("event_version", version)
    .eq("status", "active");
}

/** The active joint matrix for an event, or null when none has been written. */
export async function loadJointMatrix(eventId: string): Promise<JointMatrix | null> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_joint_samples")
    .select("player_ids, sim_count, matrix_b64")
    .eq("event_id", eventId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { player_ids: string[]; sim_count: number; matrix_b64: string };
  const bytes = gunzipSync(Buffer.from(row.matrix_b64, "base64"));
  const positions = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { playerIds: row.player_ids, simCount: row.sim_count, positions };
}

/** Active matrices for several events at once (cross-event acca pricing). */
export async function loadJointMatrices(eventIds: string[]): Promise<Map<string, JointMatrix>> {
  const out = new Map<string, JointMatrix>();
  if (eventIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("fantasy_joint_samples")
    .select("event_id, player_ids, sim_count, matrix_b64")
    .in("event_id", eventIds)
    .eq("status", "active");
  if (error) throw error;
  for (const row of (data ?? []) as {
    event_id: string; player_ids: string[]; sim_count: number; matrix_b64: string;
  }[]) {
    const bytes = gunzipSync(Buffer.from(row.matrix_b64, "base64"));
    const positions = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    out.set(row.event_id, { playerIds: row.player_ids, simCount: row.sim_count, positions });
  }
  return out;
}

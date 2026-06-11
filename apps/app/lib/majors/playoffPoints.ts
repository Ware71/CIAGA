import type { SupabaseClient } from "@supabase/supabase-js";
import { computeFormulaPoints, FEDEX_POINTS } from "@/lib/events/constants";

type Admin = SupabaseClient;

export type PlayoffFinalPosition = { profile_id: string; position: number };

/**
 * Writes a resolved playoff/countback outcome onto the event leaderboard:
 * sets playoff_result + playoff_final_position on each tied player's entry,
 * then recomputes their points_earned from the playoff-resolved position.
 *
 * MUST be called AFTER ciaga_compute_event_leaderboard — the RPC deletes and
 * re-inserts every entry, which drops the playoff columns.
 *
 * Field size for points: the tied players' positions are positions in the FULL
 * event field, so the formula uses the whole field (points_config.num_participants,
 * else the count of entries with a net score) — not just the playoff participants.
 */
export async function applyPlayoffResultToLeaderboard(args: {
  admin: Admin;
  eventId: string;
  winnerProfileId: string;
  finalPositions: PlayoffFinalPosition[];
  resolutionType: "playoff" | "countback";
}): Promise<void> {
  const { admin, eventId, winnerProfileId, finalPositions, resolutionType } = args;

  const isCountback = resolutionType === "countback";
  const wonLabel = isCountback ? "won_countback" : "won_playoff";
  const lostLabel = isCountback ? "lost_countback" : "lost_playoff";

  for (const fp of finalPositions) {
    await admin
      .from("event_leaderboard_entries")
      .update({
        playoff_result: fp.profile_id === winnerProfileId ? wonLabel : lostLabel,
        playoff_final_position: fp.position,
      })
      .eq("event_id", eventId)
      .eq("profile_id", fp.profile_id);
  }

  const { data: eventData } = await admin
    .from("events")
    .select("points_model, points_table, points_config, num_rounds")
    .eq("id", eventId)
    .single();

  if (!eventData || (eventData as any).points_model === "none") return;

  const model = (eventData as any).points_model;
  const table = (eventData as any).points_table ?? {};
  const config = (eventData as any).points_config ?? {};
  const numRounds = (eventData as any).num_rounds ?? 1;

  const configuredParticipants = (config as any)?.num_participants;
  let fieldSize: number;
  if (configuredParticipants != null) {
    fieldSize = Number(configuredParticipants);
  } else {
    const { count } = await admin
      .from("event_leaderboard_entries")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .not("net_score", "is", null);
    fieldSize = Math.max(count ?? finalPositions.length, 1);
  }

  for (const fp of finalPositions) {
    let pts: number | null = null;
    if (model === "fedex_style") {
      pts = FEDEX_POINTS[fp.position - 1] ?? 0;
    } else if (model === "position_based" || model === "custom_table") {
      pts = typeof table[String(fp.position)] === "number" ? table[String(fp.position)] : null;
    } else if (model === "ciaga_formula" || model === "custom_formula") {
      pts = computeFormulaPoints(fp.position, fieldSize, numRounds, config);
    }
    await admin
      .from("event_leaderboard_entries")
      .update({ points_earned: pts })
      .eq("event_id", eventId)
      .eq("profile_id", fp.profile_id);
  }
}

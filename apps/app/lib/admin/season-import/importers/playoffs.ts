import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPlayoffResultToLeaderboard } from "@/lib/majors/playoffPoints";
import type { ParsedPlayoff } from "../parse";

type Admin = SupabaseClient;

/**
 * Records resolved playoff/countback outcomes for imported events.
 *
 * MUST run AFTER ciaga_compute_event_leaderboard for the event — the RPC
 * deletes + re-inserts every leaderboard entry, dropping playoff columns.
 *
 * Idempotent per event: an event with an existing event_playoffs row is skipped
 * entirely (the orchestrator also skips that event's leaderboard recompute on
 * re-import so the stored playoff outcome is never wiped).
 */
export async function importPlayoffs(args: {
  admin: Admin;
  recordedBy: string;
  playoffRows: ParsedPlayoff[];
  eventIdByName: Map<string, string>;
  eventsWithExistingPlayoff: Set<string>;
  eventFinishTimes: Map<string, string>; // event_id → ISO finish of the last imported round
  eventDateByName: Map<string, string>;
  summary: any;
}) {
  const { admin, recordedBy, playoffRows, eventIdByName, eventsWithExistingPlayoff, eventFinishTimes, eventDateByName, summary } = args;
  if (!playoffRows.length) return;

  const byEvent = new Map<string, ParsedPlayoff[]>();
  for (const row of playoffRows) {
    if (!byEvent.has(row.event_name)) byEvent.set(row.event_name, []);
    byEvent.get(row.event_name)!.push(row);
  }

  for (const [eventName, rows] of byEvent.entries()) {
    const eventId = eventIdByName.get(eventName) ?? rows[0].event_id;
    if (!eventId) throw new Error(`Playoff: event "${eventName}" did not resolve`);

    if (eventsWithExistingPlayoff.has(eventId)) {
      summary.playoffs_skipped++;
      continue;
    }

    const finalPositions = rows
      .filter(r => r.profile_id && r.final_position != null)
      .map(r => ({ profile_id: r.profile_id, position: r.final_position! }));
    const winner = finalPositions.find(fp => fp.position === 1);
    if (!winner) throw new Error(`Playoff for "${eventName}": no player with Final Position 1`);

    const resolutionType = rows[0].resolution_type === "countback" ? "countback" : "playoff";

    // Backdate completion to ~30 min after the last round finished
    const finishIso = eventFinishTimes.get(eventId);
    const eventDate = eventDateByName.get(eventName);
    const base = finishIso ? new Date(finishIso) : new Date(eventDate ? `${eventDate}T17:00:00.000Z` : Date.now());
    const completedAt = new Date(base.getTime() + 30 * 60_000).toISOString();

    const { error: poErr } = await admin.from("event_playoffs").insert({
      event_id:          eventId,
      status:            "completed",
      resolution_type:   resolutionType,
      tied_profile_ids:  finalPositions.map(fp => fp.profile_id),
      winner_profile_id: winner.profile_id,
      created_by:        recordedBy,
      created_at:        base.toISOString(),
      completed_at:      completedAt,
    });
    if (poErr) throw new Error(`Create playoff for "${eventName}" failed: ${poErr.message}`);

    await applyPlayoffResultToLeaderboard({
      admin,
      eventId,
      winnerProfileId: winner.profile_id,
      finalPositions,
      resolutionType,
    });

    summary.playoffs_created++;
  }
}

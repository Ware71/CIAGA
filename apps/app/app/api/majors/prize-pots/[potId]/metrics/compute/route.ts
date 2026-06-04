import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/prize-pots/[potId]/metrics/compute
// Auto-computes metric values for enrolled players from hole score data.
// Currently only supports metric_type = 'twos' (holes scored 2).
// Updates prize_pot_entries.metric_value and metric_detail for each enrolled player.
export async function POST(req: Request, { params }: { params: Promise<{ potId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { potId } = await params;

    const { data: pot } = await supabaseAdmin
      .from("prize_pots")
      .select("*")
      .eq("id", potId)
      .maybeSingle();

    if (!pot) return NextResponse.json({ error: "Prize pot not found." }, { status: 404 });
    if ((pot as any).metric_type !== "twos") {
      return NextResponse.json({ error: "Auto-compute is only supported for metric_type = 'twos'." }, { status: 400 });
    }
    if (!(pot as any).event_id) {
      return NextResponse.json({ error: "Auto-compute requires an event-scoped pot." }, { status: 400 });
    }
    if ((pot as any).status === "distributed") {
      return NextResponse.json({ error: "Cannot recompute metrics on a distributed pot." }, { status: 400 });
    }

    const { data: m } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", (pot as any).group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!m || !["owner", "admin"].includes((m as any).role)) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const eventId: string = (pot as any).event_id;

    // Get all enrolled players
    const { data: entries } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("profile_id")
      .eq("prize_pot_id", potId);

    if (!entries || entries.length === 0) {
      return NextResponse.json({ updated: 0, results: [] });
    }

    const enrolledIds = (entries as any[]).map((e) => e.profile_id);

    // Get accepted round submissions for this event and these players
    const { data: submissions } = await supabaseAdmin
      .from("event_round_submissions")
      .select("profile_id, round_id")
      .eq("event_id", eventId)
      .eq("accepted", true)
      .in("profile_id", enrolledIds);

    if (!submissions || submissions.length === 0) {
      return NextResponse.json({ updated: 0, results: [], message: "No accepted round submissions found." });
    }

    // Unique round_ids to query round_participants
    const roundIds = [...new Set((submissions as any[]).map((s) => s.round_id))];

    // Get round_participants for these rounds (enrolled players only)
    const { data: participants } = await supabaseAdmin
      .from("round_participants")
      .select("id, round_id, profile_id")
      .in("round_id", roundIds)
      .in("profile_id", enrolledIds);

    if (!participants || participants.length === 0) {
      return NextResponse.json({ updated: 0, results: [], message: "No round participants found." });
    }

    const participantIds = (participants as any[]).map((p) => p.id);

    // Get all hole scores of 2 for these participants
    const { data: twoScores } = await supabaseAdmin
      .from("round_score_events")
      .select("participant_id, hole_number, strokes, round_id")
      .in("participant_id", participantIds)
      .eq("strokes", 2);

    // Build participant_id → {profile_id, round_id} lookup
    const participantMap: Record<string, { profile_id: string; round_id: string }> = {};
    for (const p of participants as any[]) {
      participantMap[p.id] = { profile_id: p.profile_id, round_id: p.round_id };
    }

    // Aggregate twos per profile_id
    const twosPerPlayer: Record<string, Array<{ round_id: string; hole_number: number; score: number }>> = {};
    for (const score of twoScores ?? [] as any[]) {
      const info = participantMap[score.participant_id];
      if (!info) continue;
      if (!twosPerPlayer[info.profile_id]) twosPerPlayer[info.profile_id] = [];
      twosPerPlayer[info.profile_id].push({
        round_id: info.round_id,
        hole_number: score.hole_number,
        score: score.strokes,
      });
    }

    // Update each enrolled player's metric values
    const results: Array<{ profile_id: string; twos: number }> = [];
    for (const pid of enrolledIds) {
      const details = twosPerPlayer[pid] ?? [];
      const { error: updateErr } = await supabaseAdmin
        .from("prize_pot_entries")
        .update({ metric_value: details.length, metric_detail: details.length > 0 ? details : null })
        .eq("prize_pot_id", potId)
        .eq("profile_id", pid);

      if (!updateErr) results.push({ profile_id: pid, twos: details.length });
    }

    return NextResponse.json({ updated: results.length, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

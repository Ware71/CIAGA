import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

function computeGross(scoreEvents: any[]): number | null {
  if (!scoreEvents?.length) return null;
  const latest: Record<number, number> = {};
  for (const e of scoreEvents.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (e.strokes != null) latest[e.hole_number] = e.strokes;
  }
  const vals = Object.values(latest);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
}

// GET /api/majors/events/[id]/leaderboard/[profile_id]
// Returns accepted round submissions for a player in this event, with per-round
// gross (summed from round_score_events), net, and handicap data.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; profile_id: string }> }
) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id, profile_id } = await params;

    const [{ data: submissions, error }, { data: entry }] = await Promise.all([
      supabaseAdmin
        .from("event_round_submissions")
        .select(
          `event_round_id, round_id, accepted,
           event_round:event_rounds(round_number, name)`
        )
        .eq("event_id", id)
        .eq("profile_id", profile_id)
        .eq("accepted", true),
      supabaseAdmin
        .from("event_entries")
        .select("assigned_handicap_index")
        .eq("event_id", id)
        .eq("profile_id", profile_id)
        .maybeSingle(),
    ]);

    if (error) throw error;

    const roundIds = (submissions ?? []).map((s: any) => s.round_id).filter(Boolean);

    const { data: roundStats } = roundIds.length > 0
      ? await supabaseAdmin
          .from("round_participants")
          .select(
            `round_id, course_handicap_used, playing_handicap_used,
             round_score_events(hole_number, strokes, created_at)`
          )
          .eq("profile_id", profile_id)
          .in("round_id", roundIds)
      : { data: [] };

    const statsMap: Record<string, any> = {};
    for (const rs of (roundStats ?? []) as any[]) statsMap[rs.round_id] = rs;

    const sorted = (submissions ?? [])
      .slice()
      .sort(
        (a: any, b: any) =>
          (a.event_round?.round_number ?? Infinity) - (b.event_round?.round_number ?? Infinity)
      )
      .map((s: any) => {
        const stats = statsMap[s.round_id];
        const gross = computeGross(stats?.round_score_events ?? []);
        const ph: number | null = stats?.playing_handicap_used ?? null;
        const ch: number | null = stats?.course_handicap_used ?? null;
        const net = gross != null ? gross - (ph ?? ch ?? 0) : null;
        return {
          ...s,
          gross_score: gross,
          net_score_snapshot: net,
          course_handicap: ch,
          playing_handicap: ph,
        };
      });

    return NextResponse.json(
      { rounds: sorted, entry: entry ?? null },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

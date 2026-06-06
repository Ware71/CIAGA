import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/leaderboard/[profile_id]
// Returns accepted round submissions for a player in this competition, ordered by round number.
// Used by the player breakdown sheet on the competition leaderboard.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; profile_id: string }> }
) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id, profile_id } = await params;

    const [{ data, error }, { data: entry }] = await Promise.all([
      supabaseAdmin
        .from("event_round_submissions")
        .select(
          `event_round_id, round_id, gross_score, net_score_snapshot,
           format_points, accepted,
           event_round:event_rounds(round_number, name)`
        )
        .eq("event_id", id)
        .eq("profile_id", profile_id)
        .eq("accepted", true),
      supabaseAdmin
        .from("event_entries")
        .select("assigned_handicap_index, assigned_course_handicap, assigned_playing_handicap")
        .eq("event_id", id)
        .eq("profile_id", profile_id)
        .maybeSingle(),
    ]);

    if (error) throw error;

    const sorted = (data ?? []).slice().sort((a: any, b: any) => {
      const na = a.event_round?.round_number ?? Infinity;
      const nb = b.event_round?.round_number ?? Infinity;
      return na - nb;
    });

    return NextResponse.json({ rounds: sorted, entry: entry ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

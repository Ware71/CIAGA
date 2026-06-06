import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionHistory } from "@/lib/majors/queries";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/history
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const history = await getCompetitionHistory(id);

    // Collect all event IDs across all year groups
    const eventIds: string[] = [];
    for (const yg of history) {
      for (const { event } of yg.events) {
        eventIds.push(event.id);
      }
    }

    const viewerMap = new Map<string, { position: number | null; net_score: number | null; gross_score: number | null; course_par: number | null; to_par: number | null }>();
    let viewer_stats: {
      appearances: number;
      wins: number;
      seasons_played: number;
      best_finish: number | null;
      avg_finish: number | null;
    } | null = null;

    if (eventIds.length > 0) {
      const { data: entries } = await supabaseAdmin
        .from("event_leaderboard_entries")
        .select("event_id, position, net_score, gross_score, course_par, to_par")
        .eq("profile_id", profileId)
        .in("event_id", eventIds);

      for (const e of (entries ?? []) as any[]) {
        viewerMap.set(e.event_id, {
          position: e.position ?? null,
          net_score: e.net_score ?? null,
          gross_score: e.gross_score ?? null,
          course_par: e.course_par ?? null,
          to_par: e.to_par ?? null,
        });
      }

      if (viewerMap.size > 0) {
        const positions = Array.from(viewerMap.values())
          .map((e) => e.position)
          .filter((p): p is number => p != null);

        const playedYears = new Set<number>();
        for (const yg of history) {
          for (const { event } of yg.events) {
            if (viewerMap.has(event.id)) playedYears.add(yg.year);
          }
        }

        viewer_stats = {
          appearances: viewerMap.size,
          wins: positions.filter((p) => p === 1).length,
          seasons_played: playedYears.size,
          best_finish: positions.length > 0 ? Math.min(...positions) : null,
          avg_finish: positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null,
        };
      }
    }

    const annotatedHistory = history.map((yg) => ({
      ...yg,
      events: yg.events.map((c) => ({
        ...c,
        viewer_entry: viewerMap.get(c.event.id) ?? null,
      })),
    }));

    return NextResponse.json(
      { history: annotatedHistory, viewer_stats },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

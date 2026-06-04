import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import type { PlayerBreakdownEntry, PlayerBreakdownResponse } from "@/app/api/majors/group-seasons/[id]/player-breakdown/route";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/player-breakdown?profile_id=xxx
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;
    const url = new URL(req.url);
    const profileId = url.searchParams.get("profile_id");

    if (!profileId) {
      return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
    }

    const { data: groupEvents, error: evErr } = await supabaseAdmin
      .from("events")
      .select("id, name, event_date")
      .eq("group_id", groupId)
      .in("majors_status", ["completed", "official", "live"])
      .order("event_date", { ascending: true });

    if (evErr) throw evErr;
    const events = groupEvents ?? [];
    if (events.length === 0) {
      return NextResponse.json({ entries: [] } satisfies PlayerBreakdownResponse);
    }

    const eventIds = events.map((e) => e.id as string);
    const eventMap = new Map(events.map((e) => [e.id as string, e]));

    const { data: entries, error: leErr } = await supabaseAdmin
      .from("event_leaderboard_entries")
      .select("event_id, position, net_score, gross_score, points_earned, format_points")
      .in("event_id", eventIds)
      .eq("profile_id", profileId);

    if (leErr) throw leErr;

    const result: PlayerBreakdownEntry[] = (entries ?? []).map((e: any) => {
      const ev = eventMap.get(e.event_id);
      return {
        event_id: e.event_id,
        event_name: ev?.name ?? "Unknown",
        event_date: ev?.event_date ?? null,
        position: e.position ?? null,
        net_score: e.net_score ?? null,
        gross_score: e.gross_score ?? null,
        points_earned: e.points_earned ?? null,
        format_points: e.format_points ?? null,
      };
    });

    result.sort((a, b) => {
      if (!a.event_date) return 1;
      if (!b.event_date) return -1;
      return a.event_date.localeCompare(b.event_date);
    });

    return NextResponse.json({ entries: result } satisfies PlayerBreakdownResponse, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

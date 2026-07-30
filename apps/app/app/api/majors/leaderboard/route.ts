import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupStandings } from "@/lib/majors/queries";
import { getEventLeaderboardPayload } from "@/lib/majors/eventLeaderboardPayload";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);

    const eventId = url.searchParams.get("event_id");
    const groupId = url.searchParams.get("group_id");

    if (eventId) {
      // Freeze/reveal logic lives in lib/majors/eventLeaderboardPayload so the
      // server-rendered event page produces a byte-identical payload.
      const payload = await getEventLeaderboardPayload(eventId, profileId);
      if (!payload) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    }

    if (groupId) {
      const rows = await getGroupStandings(groupId);
      // Standings themselves are masked in ciaga_compute_group_standings (a
      // frozen event contributes its freeze-snapshot position/points, not the
      // real ones). Surface the fact that a ceremony is in progress so the
      // client can badge the table — without it, callers had no way to know
      // these numbers are provisional.
      const { data: frozen } = await supabaseAdmin
        .from("events")
        .select("id, name")
        .eq("group_id", groupId)
        .eq("leaderboard_freeze_state", "frozen")
        .in("standings_contribution", ["season", "both"]);
      return NextResponse.json(
        {
          rows,
          freeze: {
            any_frozen: (frozen ?? []).length > 0,
            frozen_events: (frozen ?? []).map((e: any) => ({ id: e.id, name: e.name })),
          },
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json({ error: "Provide event_id or group_id" }, { status: 400 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

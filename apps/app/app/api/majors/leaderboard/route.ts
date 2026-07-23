import { NextResponse } from "next/server";
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
      return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Provide event_id or group_id" }, { status: 400 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { generateEventFantasy } from "@/lib/fantasy/odds";

export const runtime = "nodejs";
// Generation rebuilds profiles and runs the initial simulation.
export const maxDuration = 60;

// POST /api/fantasy/events/[eventId]/generate — activate fantasy for an event
// (group owner/admin). Idempotent: re-running adds markets for new entrants
// and re-prices; existing markets/picks are untouched.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventId } = await params;

    const { data: eventRow, error: eventErr } = await supabaseAdmin
      .from("events")
      .select("group_id")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr) throw eventErr;
    const groupId = (eventRow as { group_id: string | null } | null)?.group_id;
    if (!groupId) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const role = await getGroupRole(groupId, profileId);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json(
        { error: "Only group owner or admin can generate fantasy markets" },
        { status: 403 }
      );
    }

    const result = await generateEventFantasy(eventId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const lowered = String(msg).toLowerCase();
    const status = lowered.includes("auth")
      ? 401
      : lowered.includes("not enabled") || lowered.includes("single-round") ||
        lowered.includes("at least 2") || lowered.includes("already finished")
      ? 400
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

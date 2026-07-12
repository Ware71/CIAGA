import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";

export const runtime = "nodejs";

// GET /api/fantasy/events/[eventId]/narrative — the event's auto-written
// "Event preview" text, for surfacing on the competition event Overview tab.
// Read-only: it never generates or re-prices (unlike the market-board odds
// route), so a competition page view stays fast and side-effect-free. Returns
// { narrative: null } when the event has no fantasy state yet — the same
// condition under which the market board itself has nothing to show.
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventId } = await params;

    const { data: eventRow } = await supabaseAdmin
      .from("events")
      .select("group_id")
      .eq("id", eventId)
      .maybeSingle();
    const groupId = (eventRow as { group_id: string | null } | null)?.group_id ?? null;
    if (!groupId) return NextResponse.json({ narrative: null });

    const role = await getGroupRole(groupId, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { data: stateRow } = await supabaseAdmin
      .from("fantasy_event_state")
      .select("narrative")
      .eq("event_id", eventId)
      .maybeSingle();
    const narrative = (stateRow as { narrative: string | null } | null)?.narrative ?? null;

    return NextResponse.json({ narrative }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

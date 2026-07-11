import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { settleFantasyEvent } from "@/lib/fantasy/settlement";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/fantasy/events/[eventId]/settle — manual settlement (group
// owner/admin). Normally settlement runs automatically when the event
// completes; this is the recovery/verification path. Idempotent.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventId } = await params;

    const { data: eventRow } = await supabaseAdmin
      .from("events")
      .select("group_id")
      .eq("id", eventId)
      .maybeSingle();
    const groupId = (eventRow as { group_id: string | null } | null)?.group_id;
    if (!groupId) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const role = await getGroupRole(groupId, profileId);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json(
        { error: "Only group owner or admin can settle fantasy picks" },
        { status: 403 }
      );
    }

    const result = await settleFantasyEvent(eventId);
    return NextResponse.json(result, { status: result.settled ? 200 : 400 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

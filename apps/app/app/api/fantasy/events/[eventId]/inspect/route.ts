import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { inspectEvent } from "@/lib/fantasy/inspect";

export const runtime = "nodejs";
// May build missing profiles and always re-runs the simulation.
export const maxDuration = 60;

// GET /api/fantasy/events/[eventId]/inspect — odds inspector payload.
// Dev tool: only exists in the sandbox environment (same gate as
// SandboxDevTools) and only for group owner/admin.
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    if (process.env.NEXT_PUBLIC_APP_ENV !== "sandbox") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

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
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const payload = await inspectEvent(eventId);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

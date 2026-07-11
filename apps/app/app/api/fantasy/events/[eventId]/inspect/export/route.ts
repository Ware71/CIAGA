import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { buildInspectWorkbook } from "@/lib/fantasy/inspectExport";

export const runtime = "nodejs";
// Re-runs the simulation and builds a multi-sheet workbook.
export const maxDuration = 60;

// GET /api/fantasy/events/[eventId]/inspect/export — inspector Excel export.
// Same gate as the inspector: sandbox environment + group owner/admin only.
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

    const { buffer, filename } = await buildInspectWorkbook(eventId);
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventParticipants } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/participants
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const participants = await getEventParticipants(id);
    return NextResponse.json({ participants }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

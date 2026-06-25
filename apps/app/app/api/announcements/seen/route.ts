import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

type Body = { announcement_id?: string };

// POST /api/announcements/seen — mark an announcement as seen for this user so
// it is never shown again.
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = (await req.json()) as Body;
    if (!body.announcement_id) {
      return NextResponse.json({ error: "Missing announcement_id" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("announcement_views")
      .upsert(
        { announcement_id: body.announcement_id, profile_id: profileId },
        { onConflict: "announcement_id,profile_id", ignoreDuplicates: true }
      );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

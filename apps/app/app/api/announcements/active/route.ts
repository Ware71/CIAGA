import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/announcements/active — active, in-window announcements this user
// has not yet seen, highest priority first.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const nowIso = new Date().toISOString();

    const { data: anns, error } = await supabaseAdmin
      .from("announcements")
      .select("id, slug, kind, title, body, image_url, cta_label, cta_url, priority, created_at")
      .eq("active", true)
      .or(`publish_at.is.null,publish_at.lte.${nowIso}`)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const list = anns ?? [];
    if (list.length === 0) return NextResponse.json({ announcements: [] });

    const { data: views } = await supabaseAdmin
      .from("announcement_views")
      .select("announcement_id")
      .eq("profile_id", profileId)
      .in(
        "announcement_id",
        list.map((a: any) => a.id)
      );

    const seen = new Set((views ?? []).map((v: any) => v.announcement_id));
    const unseen = list.filter((a: any) => !seen.has(a.id));

    return NextResponse.json(
      { announcements: unseen },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

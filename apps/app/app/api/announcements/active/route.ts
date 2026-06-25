import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/announcements/active — active, in-window announcements this user
// has not yet seen, highest priority first.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const now = Date.now();

    const { data: anns, error } = await supabaseAdmin
      .from("announcements")
      .select(
        "id, slug, kind, title, body, image_url, cta_label, cta_url, priority, created_at, publish_at, expires_at"
      )
      .eq("active", true)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    // Filter the publish/expiry window in JS — ISO timestamps inside PostgREST
    // .or() filters are brittle, so keep the query simple and window here.
    const list = (anns ?? []).filter((a: any) => {
      const publishOk = !a.publish_at || new Date(a.publish_at).getTime() <= now;
      const notExpired = !a.expires_at || new Date(a.expires_at).getTime() > now;
      return publishOk && notExpired;
    });
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

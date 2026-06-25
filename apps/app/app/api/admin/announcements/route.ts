import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminProfile, adminErrorStatus } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";

const FIELDS =
  "id, slug, kind, title, body, image_url, cta_label, cta_url, active, priority, publish_at, expires_at, created_at";

// GET /api/admin/announcements — list all (admin)
export async function GET(req: Request) {
  try {
    await requireAdminProfile(req);
    const { data, error } = await supabaseAdmin
      .from("announcements")
      .select(FIELDS)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ announcements: data ?? [] });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}

// POST /api/admin/announcements — create
export async function POST(req: Request) {
  try {
    const { adminProfileId } = await requireAdminProfile(req);
    const b = await req.json();

    if (!b?.title?.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    const kind = ["onboarding", "promo", "info"].includes(b.kind) ? b.kind : "info";

    const { data, error } = await supabaseAdmin
      .from("announcements")
      .insert({
        slug: b.slug?.trim() || null,
        kind,
        title: b.title.trim(),
        body: b.body ?? null,
        image_url: b.image_url ?? null,
        cta_label: b.cta_label ?? null,
        cta_url: b.cta_url ?? null,
        active: b.active ?? true,
        priority: Number.isFinite(b.priority) ? b.priority : 0,
        publish_at: b.publish_at || null,
        expires_at: b.expires_at || null,
        created_by_profile_id: adminProfileId,
      })
      .select(FIELDS)
      .single();

    if (error) throw error;
    return NextResponse.json({ announcement: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminProfile, adminErrorStatus } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";

const FIELDS =
  "id, slug, kind, title, body, image_url, cta_label, cta_url, active, priority, publish_at, expires_at, created_at";

// PATCH /api/admin/announcements/[id] — update
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminProfile(req);
    const { id } = await ctx.params;
    const b = await req.json();

    const patch: Record<string, any> = {};
    for (const k of [
      "slug",
      "kind",
      "title",
      "body",
      "image_url",
      "cta_label",
      "cta_url",
      "active",
      "priority",
      "publish_at",
      "expires_at",
    ]) {
      if (k in b) patch[k] = b[k];
    }
    if ("title" in patch && !String(patch.title ?? "").trim()) {
      return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("announcements")
      .update(patch)
      .eq("id", id)
      .select(FIELDS)
      .single();

    if (error) throw error;
    return NextResponse.json({ announcement: data });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}

// DELETE /api/admin/announcements/[id]
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminProfile(req);
    const { id } = await ctx.params;
    const { error } = await supabaseAdmin.from("announcements").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}

// /app/api/calendar/circles/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

async function assertOwner(circleId: string, profileId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("calendar_circles")
    .select("id, owner_profile_id")
    .eq("id", circleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return "Not found";
  if (data.owner_profile_id !== profileId) return "Forbidden";
  return null;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await ctx.params;
    const problem = await assertOwner(id, profileId);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: problem === "Forbidden" ? 403 : 404 });
    }

    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("calendar_circles")
      .update({ name })
      .eq("id", id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ circle: data });
  } catch (e: any) {
    const status = /unauthor/i.test(e?.message) ? 401 : 500;
    return NextResponse.json({ error: e?.message || "Server error" }, { status });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await ctx.params;
    const problem = await assertOwner(id, profileId);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: problem === "Forbidden" ? 403 : 404 });
    }

    const { error } = await supabaseAdmin.from("calendar_circles").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = /unauthor/i.test(e?.message) ? 401 : 500;
    return NextResponse.json({ error: e?.message || "Server error" }, { status });
  }
}

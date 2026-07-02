// /app/api/calendar/circles/[id]/members/route.ts
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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await ctx.params;
    const problem = await assertOwner(id, profileId);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: problem === "Forbidden" ? 403 : 404 });
    }

    const body = (await req.json().catch(() => ({}))) as { profile_id?: string };
    if (!body.profile_id) return NextResponse.json({ error: "Missing profile_id" }, { status: 400 });

    const { error } = await supabaseAdmin
      .from("calendar_circle_members")
      .upsert(
        { circle_id: id, profile_id: body.profile_id },
        { onConflict: "circle_id,profile_id", ignoreDuplicates: true }
      );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
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

    const url = new URL(req.url);
    const memberProfileId =
      url.searchParams.get("profile_id") ||
      ((await req.json().catch(() => ({}))) as { profile_id?: string }).profile_id;
    if (!memberProfileId) {
      return NextResponse.json({ error: "Missing profile_id" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("calendar_circle_members")
      .delete()
      .eq("circle_id", id)
      .eq("profile_id", memberProfileId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = /unauthor/i.test(e?.message) ? 401 : 500;
    return NextResponse.json({ error: e?.message || "Server error" }, { status });
  }
}

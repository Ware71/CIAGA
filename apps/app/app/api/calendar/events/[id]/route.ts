// /app/api/calendar/events/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

type Body = {
  title?: string | null;
  all_day?: boolean;
  start_at?: string;
  end_at?: string;
  rrule?: string | null;
  kind?: "available" | "unavailable";
};

async function assertOwner(eventId: string, profileId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .select("id, profile_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return "Not found";
  if (data.profile_id !== profileId) return "Forbidden";
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

    const body = (await req.json().catch(() => ({}))) as Body;
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.kind !== undefined) updates.kind = body.kind;
    if (body.title !== undefined) updates.title = body.title?.trim() ? body.title.trim() : null;
    if (body.all_day !== undefined) updates.all_day = !!body.all_day;
    if (body.start_at !== undefined) updates.start_at = body.start_at;
    if (body.end_at !== undefined) updates.end_at = body.end_at;
    if (body.rrule !== undefined) updates.rrule = body.rrule?.trim() ? body.rrule.trim() : null;

    const { data, error } = await supabaseAdmin
      .from("calendar_events")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ event: data });
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

    const { error } = await supabaseAdmin.from("calendar_events").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = /unauthor/i.test(e?.message) ? 401 : 500;
    return NextResponse.json({ error: e?.message || "Server error" }, { status });
  }
}

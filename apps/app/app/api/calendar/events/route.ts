// /app/api/calendar/events/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

type Body = {
  kind?: "available" | "unavailable";
  title?: string | null;
  all_day?: boolean;
  start_at?: string;
  end_at?: string;
  rrule?: string | null;
};

export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = (await req.json().catch(() => ({}))) as Body;

    if (body.kind !== "available" && body.kind !== "unavailable") {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!body.start_at || !body.end_at) {
      return NextResponse.json({ error: "Missing start_at/end_at" }, { status: 400 });
    }
    if (new Date(body.end_at).getTime() <= new Date(body.start_at).getTime()) {
      return NextResponse.json({ error: "end_at must be after start_at" }, { status: 400 });
    }

    const title = body.title?.trim() ? body.title.trim() : null;

    const { data, error } = await supabaseAdmin
      .from("calendar_events")
      .insert({
        profile_id: profileId,
        kind: body.kind,
        title,
        all_day: !!body.all_day,
        start_at: body.start_at,
        end_at: body.end_at,
        rrule: body.rrule?.trim() ? body.rrule.trim() : null,
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ event: data });
  } catch (e: any) {
    const status = /unauthor/i.test(e?.message) ? 401 : 500;
    return NextResponse.json({ error: e?.message || "Server error" }, { status });
  }
}

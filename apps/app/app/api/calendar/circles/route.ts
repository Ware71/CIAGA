// /app/api/calendar/circles/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

type Body = { name?: string };

export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("calendar_circles")
      .insert({ owner_profile_id: profileId, name })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ circle: data });
  } catch (e: any) {
    const status = /unauthor/i.test(e?.message) ? 401 : 500;
    return NextResponse.json({ error: e?.message || "Server error" }, { status });
  }
}

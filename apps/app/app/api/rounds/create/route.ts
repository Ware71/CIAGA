// /app/api/rounds/create/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  course_id?: string | null;
  name?: string | null;
  visibility?: "private" | "link" | "public";
  pending_tee_box_id?: string | null;
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = userData.user;
    const body = (await req.json().catch(() => ({}))) as Body;

    // Model B: created_by = profiles.id (not auth.users.id)
    const created_by = await getOwnedProfileIdOrThrow(user.id);

    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .insert({
        created_by,
        course_id: body.course_id ?? null,
        name: body.name ?? null,
        visibility: body.visibility ?? "private",
        status: "draft",
        pending_tee_box_id: body.pending_tee_box_id ?? null,
      })
      .select("id")
      .single();

    if (roundErr) {
      return NextResponse.json({ error: roundErr.message }, { status: 500 });
    }

    // Bootstrap: add creator as owner (profile_id = profiles.id)
    const { error: partErr } = await supabaseAdmin.from("round_participants").insert({
      round_id: round.id,
      profile_id: created_by,
      role: "owner",
      is_guest: false,
    });

    if (partErr) {
      return NextResponse.json({ error: partErr.message }, { status: 500 });
    }

    return NextResponse.json({ round_id: round.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

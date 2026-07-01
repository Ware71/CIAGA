// /app/api/rounds/withdraw/route.ts
//
// Self-service withdrawal: lets a non-owner participant remove THEMSELVES from a
// draft or scheduled round. The owner uses /api/rounds/delete-draft instead, and
// Majors-linked rounds must be withdrawn from in the Majors section (entry fees).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = { round_id: string };

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const myProfileId = await getOwnedProfileIdOrThrow(userData.user.id);

    const body = (await req.json()) as Body;
    if (!body?.round_id) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });

    // Load the round — only draft/scheduled, non-Majors rounds can be withdrawn here.
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status, event_tee_time_id")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    if (round.status !== "draft" && round.status !== "scheduled") {
      return NextResponse.json({ error: "You can only withdraw from a draft or scheduled round" }, { status: 400 });
    }
    if (round.event_tee_time_id) {
      return NextResponse.json(
        { error: "This round is part of a Majors competition. To withdraw, use the Majors section." },
        { status: 403 }
      );
    }

    // Load my participant row on this round.
    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me) return NextResponse.json({ error: "You are not in this round" }, { status: 404 });
    if (me.role === "owner") {
      return NextResponse.json({ error: "The round owner cannot withdraw — delete the round instead" }, { status: 400 });
    }

    const { error: delErr } = await supabaseAdmin
      .from("round_participants")
      .delete()
      .eq("id", me.id);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, round_id: body.round_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

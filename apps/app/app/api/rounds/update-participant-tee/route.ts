import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  round_id: string;
  participant_id: string;
  tee_box_id: string | null;
};

export async function PATCH(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const myProfileId = await getOwnedProfileIdOrThrow(userData.user.id);
    const body = (await req.json()) as Body;

    if (!body?.round_id) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });
    if (!body?.participant_id) return NextResponse.json({ error: "Missing participant_id" }, { status: 400 });

    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    if (round.status !== "draft" && round.status !== "scheduled") {
      return NextResponse.json({ error: "Tee box can only be changed before the round starts" }, { status: 400 });
    }

    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me || me.role !== "owner") {
      return NextResponse.json({ error: "Only the round owner can change player tee assignments" }, { status: 403 });
    }

    // Validate tee_box_id belongs to the round's course if provided
    if (body.tee_box_id) {
      const { data: round2 } = await supabaseAdmin
        .from("rounds")
        .select("course_id")
        .eq("id", body.round_id)
        .single();

      const { data: teeBox } = await supabaseAdmin
        .from("course_tee_boxes")
        .select("id, course_id")
        .eq("id", body.tee_box_id)
        .maybeSingle();

      if (!teeBox) return NextResponse.json({ error: "Tee box not found" }, { status: 404 });
      if (teeBox.course_id !== (round2 as any)?.course_id) {
        return NextResponse.json({ error: "Tee box does not belong to this round's course" }, { status: 400 });
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from("round_participants")
      .update({ pending_tee_box_id: body.tee_box_id ?? null })
      .eq("id", body.participant_id)
      .eq("round_id", body.round_id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

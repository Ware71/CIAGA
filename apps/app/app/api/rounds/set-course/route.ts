// /app/api/rounds/set-course/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  round_id: string;
  course_id?: string | null;
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

    const profileId = await getOwnedProfileIdOrThrow(userData.user.id);
    const body = (await req.json().catch(() => ({}))) as Body;

    if (!body.round_id) {
      return NextResponse.json({ error: "round_id required" }, { status: 400 });
    }

    // Verify round exists and user is owner
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, created_by, status")
      .eq("id", body.round_id)
      .single();

    if (roundErr || !round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    if (round.created_by !== profileId) {
      return NextResponse.json({ error: "Only owner can change course/tee" }, { status: 403 });
    }

    // Only allow changes for draft or scheduled rounds
    if (round.status !== "draft" && round.status !== "scheduled") {
      return NextResponse.json(
        { error: "Cannot change course/tee for rounds that have started" },
        { status: 400 }
      );
    }

    // Update course and/or tee
    const updates: any = {};
    if (body.course_id !== undefined) updates.course_id = body.course_id;
    if (body.pending_tee_box_id !== undefined) updates.pending_tee_box_id = body.pending_tee_box_id;

    const { error: updateErr } = await supabaseAdmin
      .from("rounds")
      .update(updates)
      .eq("id", body.round_id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

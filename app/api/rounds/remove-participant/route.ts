// /app/api/rounds/remove-participant/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  round_id: string;
  participant_id: string;
  requester_profile_id?: string | null; // optional; we verify via token anyway
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const myProfileId = await getOwnedProfileIdOrThrow(user.id);

    const body = (await req.json()) as Body;

    if (!body?.round_id) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });
    if (!body?.participant_id) return NextResponse.json({ error: "Missing participant_id" }, { status: 400 });

    // Load round status
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id,status")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    if (round.status === "live") {
      return NextResponse.json({ error: "Cannot remove participants after round is live" }, { status: 400 });
    }

    // Verify requester is owner on this round
    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role, profile_id")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me || me.role !== "owner") {
      return NextResponse.json({ error: "Only round owner can remove participants" }, { status: 403 });
    }

    // Load the participant row we're trying to remove (must belong to this round)
    const { data: victim, error: vErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role, profile_id, is_guest")
      .eq("id", body.participant_id)
      .eq("round_id", body.round_id)
      .single();

    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

    // Guardrails
    if (victim.role === "owner") {
      return NextResponse.json({ error: "Cannot remove the owner" }, { status: 400 });
    }
    if (victim.profile_id && victim.profile_id === myProfileId) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }

    // Delete participant
    const { error: delErr } = await supabaseAdmin.from("round_participants").delete().eq("id", victim.id);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, removed_participant_id: victim.id, round_id: body.round_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

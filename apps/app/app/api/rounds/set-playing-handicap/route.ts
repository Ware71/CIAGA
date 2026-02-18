// /app/api/rounds/set-playing-handicap/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  round_id: string;
  participant_id: string;
  assigned_playing_handicap: number | null; // null to clear override
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const myProfileId = await getOwnedProfileIdOrThrow(userData.user.id);
    const body = (await req.json()) as Body;

    if (!body?.round_id || !body?.participant_id) {
      return NextResponse.json({ error: "Missing round_id or participant_id" }, { status: 400 });
    }

    // Load round
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    // Manual overrides can only be set before round starts
    if (round.status !== "draft" && round.status !== "scheduled") {
      return NextResponse.json(
        { error: "Playing handicap can only be set before round starts (draft or scheduled)" },
        { status: 400 }
      );
    }

    // Load target participant
    const { data: targetParticipant, error: targetErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, profile_id, round_id")
      .eq("id", body.participant_id)
      .eq("round_id", body.round_id)
      .maybeSingle();

    if (targetErr) return NextResponse.json({ error: targetErr.message }, { status: 500 });
    if (!targetParticipant) {
      return NextResponse.json({ error: "Participant not found in this round" }, { status: 404 });
    }

    // Check permissions: owner can set for anyone, participant can set for themselves
    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role, profile_id")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me) return NextResponse.json({ error: "Not a participant in this round" }, { status: 403 });

    const isOwner = me.role === "owner";
    const isSelf = targetParticipant.profile_id === myProfileId;

    if (!isOwner && !isSelf) {
      return NextResponse.json(
        { error: "You can only set playing handicap for yourself (or owner can set for anyone)" },
        { status: 403 }
      );
    }

    // Validate handicap value
    if (body.assigned_playing_handicap !== null) {
      const value = body.assigned_playing_handicap;
      if (typeof value !== "number" || value < 0 || value > 54) {
        return NextResponse.json({ error: "Invalid handicap value (must be 0-54)" }, { status: 400 });
      }
    }

    // Update participant — write to both legacy and new columns for compatibility
    const { error: updateErr } = await supabaseAdmin
      .from("round_participants")
      .update({
        assigned_playing_handicap: body.assigned_playing_handicap,
        assigned_handicap_index: body.assigned_playing_handicap,
      })
      .eq("id", body.participant_id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, participant_id: body.participant_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

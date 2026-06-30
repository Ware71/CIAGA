import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { finishRound } from "@/lib/rounds/finishRound";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ round_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { round_id: roundId } = await ctx.params;

    if (!roundId) throw new Error("Missing round_id");

    // Must be a participant in this round (any role may finish — consistent with
    // any-participant scoring policy; competition rounds add players as role="player").
    const { data: rp, error: rpErr } = await supabaseAdmin
      .from("round_participants")
      .select("role")
      .eq("round_id", roundId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (rpErr) throw rpErr;

    if (!rp) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Optional client-computed result (winner / match-play margin) for the
    // completion notification. Best-effort — ignore a malformed/missing body.
    let result: Record<string, any> | undefined;
    try {
      const body = await req.json();
      if (body && typeof body === "object" && body.result) result = body.result;
    } catch {
      /* no body */
    }

    await finishRound({ roundId, actorProfileId: profileId, result });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}

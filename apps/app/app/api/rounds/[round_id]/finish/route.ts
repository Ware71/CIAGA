import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { emitRoundPlayedFeedItem } from "@/lib/feed/generators/roundPlayed";
import { emitHoleEventFeedItems } from "@/lib/feed/generators/holeEvents";
import { emitAchievementFeedItems } from "@/lib/feed/generators/achievements";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ round_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { round_id: roundId } = await ctx.params;

    if (!roundId) throw new Error("Missing round_id");

    // Must be owner or scorer for this round
    const { data: rp, error: rpErr } = await supabaseAdmin
      .from("round_participants")
      .select("role")
      .eq("round_id", roundId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (rpErr) throw rpErr;

    const role = (rp as any)?.role as string | undefined;
    if (!role || (role !== "owner" && role !== "scorer")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update round status
    const { error: upErr } = await supabaseAdmin
      .from("rounds")
      .update({ status: "finished" })
      .eq("id", roundId);

    if (upErr) throw upErr;

    // Emit feed items (best effort)
    await emitRoundPlayedFeedItem({
      roundId,
      actorProfileId: profileId,
    });

    // Hole events + achievements in parallel (non-blocking)
    await Promise.allSettled([
      emitHoleEventFeedItems({ roundId, actorProfileId: profileId }),
      emitAchievementFeedItems({ roundId, actorProfileId: profileId }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}
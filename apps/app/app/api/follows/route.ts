import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { notifyNewFollower } from "@/lib/notifications/socialActivity";

export const runtime = "nodejs";

/**
 * POST /api/follows — follow a profile.
 * Body: { following_id }
 *
 * Follows used to be inserted straight from the client under RLS. They still
 * could be, but the follow notification has to originate server-side, so the
 * write moved here rather than leaving the notification skippable by anyone
 * calling the table directly. The RLS insert policy remains as the backstop.
 */
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json().catch(() => ({}));
    const followingId = body?.following_id as string | undefined;

    if (!followingId) {
      return NextResponse.json({ error: "following_id required" }, { status: 400 });
    }
    if (followingId === profileId) {
      return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
    }

    // Idempotent: re-following is a no-op rather than a duplicate-key error, so
    // a double-tap doesn't surface as a failure or fire a second notification.
    const { data: existing } = await supabaseAdmin
      .from("follows")
      .select("follower_id")
      .eq("follower_id", profileId)
      .eq("following_id", followingId)
      .maybeSingle();

    if (existing) return NextResponse.json({ ok: true, already_following: true });

    const { error } = await supabaseAdmin
      .from("follows")
      .insert({ follower_id: profileId, following_id: followingId });

    if (error) throw error;

    await notifyNewFollower({
      followerProfileId: profileId,
      followedProfileId: followingId,
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

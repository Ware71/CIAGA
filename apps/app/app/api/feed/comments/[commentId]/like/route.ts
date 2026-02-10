// app/api/feed/comments/[commentId]/like/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const dynamic = "force-dynamic";

async function resolveParams(maybeParams: any): Promise<Record<string, any> | undefined> {
  if (!maybeParams) return undefined;
  if (typeof maybeParams?.then === "function") return await maybeParams; // Next can pass params as Promise
  return maybeParams;
}

function pickCommentId(params: Record<string, any> | undefined) {
  if (!params) return "";
  return (
    params.commentId ??
    params.id ??
    params.comment_id ??
    (Object.values(params)[0] as string | undefined) ??
    ""
  );
}

export async function POST(req: Request, ctx: { params: any }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const resolvedParams = await resolveParams(ctx?.params);
    const commentId = pickCommentId(resolvedParams);

    if (!commentId || typeof commentId !== "string") {
      return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
    }

    // Ensure comment exists
    const { data: comment, error: cErr } = await supabaseAdmin
      .from("feed_comments")
      .select("id, vote_count")
      .eq("id", commentId)
      .maybeSingle();

    if (cErr) throw cErr;
    if (!comment) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    // Toggle vote (unique: comment_id + voter_profile_id)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("feed_comment_votes")
      .select("comment_id")
      .eq("comment_id", commentId)
      .eq("voter_profile_id", profileId)
      .maybeSingle();

    if (exErr) throw exErr;

    let liked = false;

    if (existing) {
      const { error: delErr } = await supabaseAdmin
        .from("feed_comment_votes")
        .delete()
        .eq("comment_id", commentId)
        .eq("voter_profile_id", profileId);

      if (delErr) throw delErr;
      liked = false;
    } else {
      const { error: insErr } = await supabaseAdmin.from("feed_comment_votes").insert({
        comment_id: commentId,
        voter_profile_id: profileId,
      });

      if (insErr) throw insErr;
      liked = true;
    }

    // vote_count is maintained by trigger in DB; re-read for accurate count
    const { data: refreshed, error: rErr } = await supabaseAdmin
      .from("feed_comments")
      .select("vote_count")
      .eq("id", commentId)
      .maybeSingle();

    if (rErr) throw rErr;

    return NextResponse.json({ liked, count: refreshed?.vote_count ?? 0 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const lower = msg.toLowerCase();
    const status =
      lower.includes("token") || lower.includes("bearer") || lower.includes("unauth") || lower.includes("auth")
        ? 401
        : 400;

    return NextResponse.json({ error: msg }, { status });
  }
}

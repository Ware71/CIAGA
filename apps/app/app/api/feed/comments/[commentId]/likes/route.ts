// app/api/feed/comments/[commentId]/likes/route.ts
//
// Who liked a comment.

import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { assertViewerCanReadFeedItem } from "@/lib/feed/commands";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/feed/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

export async function GET(req: Request, ctx: { params: Promise<{ commentId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { commentId } = await ctx.params;

    if (!commentId) {
      return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
    }

    // Authorization hangs off the parent item, so resolve that first.
    const { data: comment, error: cErr } = await supabaseAdmin
      .from("feed_comments")
      .select("id, feed_item_id")
      .eq("id", commentId)
      .maybeSingle();

    if (cErr) throw cErr;
    if (!comment) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await assertViewerCanReadFeedItem((comment as any).feed_item_id, profileId);

    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 30, 1, 100);
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? decodeFeedCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    // feed_comment_votes has a composite primary key and no id column, so the
    // keyset's tie-break is the voter's profile id.
    let query = supabaseAdmin
      .from("feed_comment_votes")
      .select("voter_profile_id, created_at, profiles:voter_profile_id ( id, name, avatar_url )")
      .eq("comment_id", commentId)
      .order("created_at", { ascending: false })
      .order("voter_profile_id", { ascending: false })
      .limit(limit + 1);

    if (cursor?.occurred_at && cursor?.id) {
      query = query.or(
        `created_at.lt.${cursor.occurred_at},and(created_at.eq.${cursor.occurred_at},voter_profile_id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as any[];
    const trimmed = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    const people = trimmed.map((r) => ({
      profile_id: r.profiles?.id ?? r.voter_profile_id,
      display_name: r.profiles?.name ?? "Player",
      avatar_url: r.profiles?.avatar_url ?? null,
      emoji: "👍",
      is_me: r.voter_profile_id === profileId,
    }));

    const last = trimmed[trimmed.length - 1];

    return NextResponse.json(
      {
        people,
        by_emoji: {},
        total: people.length + (hasMore ? 1 : 0),
        next_cursor:
          hasMore && last
            ? encodeFeedCursor({ occurred_at: last.created_at, id: last.voter_profile_id })
            : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const lower = String(msg).toLowerCase();
    const status = lower.includes("forbidden")
      ? 403
      : lower.includes("auth") || lower.includes("unauth")
        ? 401
        : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

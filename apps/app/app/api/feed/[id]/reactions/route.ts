// app/api/feed/[id]/reactions/route.ts
//
// Who reacted to a post. The rows have always carried profile_id — the feed
// just never surfaced them, folding everything to a count and the viewer's own
// emoji.

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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: feedItemId } = await ctx.params;

    if (!feedItemId) {
      return NextResponse.json({ error: "Invalid feed item id" }, { status: 400 });
    }

    // The reactor list is as sensitive as the post — don't hand it out for an
    // item the viewer isn't targeted on.
    await assertViewerCanReadFeedItem(feedItemId, profileId);

    const url = new URL(req.url);
    const emoji = url.searchParams.get("emoji");
    const limit = clampInt(url.searchParams.get("limit"), 30, 1, 100);
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? decodeFeedCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    let query = supabaseAdmin
      .from("feed_reactions")
      .select("id, emoji, created_at, profile_id, profiles:profile_id ( id, name, avatar_url )")
      .eq("feed_item_id", feedItemId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (emoji) query = query.eq("emoji", emoji);

    // Same (timestamp, id) keyset the feed uses; the cursor helper calls the
    // timestamp `occurred_at`, here it's created_at.
    if (cursor?.occurred_at && cursor?.id) {
      query = query.or(
        `created_at.lt.${cursor.occurred_at},and(created_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as any[];
    const trimmed = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    const people = trimmed.map((r) => ({
      profile_id: r.profiles?.id ?? r.profile_id,
      display_name: r.profiles?.name ?? "Player",
      avatar_url: r.profiles?.avatar_url ?? null,
      emoji: r.emoji as string,
      is_me: r.profile_id === profileId,
    }));

    // The tab strip needs the whole breakdown, not just this page's — otherwise
    // filtering by an emoji that fell off page one would show an empty sheet.
    const { data: allRows, error: allErr } = await supabaseAdmin
      .from("feed_reactions")
      .select("emoji")
      .eq("feed_item_id", feedItemId);
    if (allErr) throw allErr;

    const byEmoji: Record<string, number> = {};
    for (const r of (allRows ?? []) as any[]) {
      if (!r?.emoji) continue;
      byEmoji[r.emoji] = (byEmoji[r.emoji] ?? 0) + 1;
    }

    const last = trimmed[trimmed.length - 1];

    return NextResponse.json(
      {
        people,
        by_emoji: byEmoji,
        total: (allRows ?? []).length,
        next_cursor:
          hasMore && last
            ? encodeFeedCursor({ occurred_at: last.created_at, id: last.id })
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

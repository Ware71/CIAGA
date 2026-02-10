// app/api/feed/[id]/comments/route.ts
import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

function pickFeedItemId(params: Record<string, any> | undefined) {
  if (!params) return "";
  return (
    params.id ??
    params.feedItemId ??
    params.feed_item_id ??
    (Object.values(params)[0] as string | undefined) ??
    ""
  );
}

async function resolveParams(maybeParams: any): Promise<Record<string, string> | undefined> {
  if (!maybeParams) return undefined;
  // If Next passes params as a Promise, await it
  if (typeof maybeParams?.then === "function") return await maybeParams;
  return maybeParams;
}

export async function GET(req: Request, context: { params: any }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const resolvedParams = await resolveParams(context?.params);
    let feedItemId = pickFeedItemId(resolvedParams);

    // Support "live:<round_id>"
    if (typeof feedItemId === "string" && feedItemId.startsWith("live:")) {
      feedItemId = feedItemId.slice("live:".length);
    }

    if (!feedItemId || typeof feedItemId !== "string") {
      return NextResponse.json({ error: "Invalid feed item id" }, { status: 400 });
    }

    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 100, 1, 200);

    const { data: comments, error } = await supabaseAdmin
      .from("feed_comments")
      .select("id, feed_item_id, profile_id, body, created_at, parent_comment_id, vote_count")
      .eq("feed_item_id", feedItemId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const commentIds = (comments ?? []).map((c: any) => c.id);

    let likedSet = new Set<string>();

    if (commentIds.length) {
      const { data: likedRows, error: lErr } = await supabaseAdmin
        .from("feed_comment_votes")
        .select("comment_id")
        .eq("voter_profile_id", profileId)
        .in("comment_id", commentIds);

      if (lErr) throw lErr;

      likedSet = new Set((likedRows ?? []).map((r: any) => r.comment_id));
    }

    const profileIds = Array.from(new Set((comments ?? []).map((c: any) => c.profile_id).filter(Boolean)));

    const profilesMap = new Map<string, { id: string; name: string; avatar_url: string | null }>();

    if (profileIds.length) {
      const { data: profs, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", profileIds);

      if (pErr) throw pErr;

      for (const p of profs ?? []) {
        profilesMap.set((p as any).id, {
          id: (p as any).id,
          name: (p as any).name ?? "Player",
          avatar_url: (p as any).avatar_url ?? null,
        });
      }
    }

    const items = (comments ?? []).map((c: any) => {
      const p = profilesMap.get(c.profile_id);
      const authorName = p?.name ?? "Player";
      const authorAvatar = p?.avatar_url ?? null;

      return {
        id: c.id,
        profile_id: c.profile_id,
        body: c.body,
        created_at: c.created_at,
        is_mine: c.profile_id === profileId,
        like_count: c.vote_count ?? 0,
        i_liked: likedSet.has(c.id),

        // Back-compat + consistent keys for new UI:
        author: {
          // new preferred keys:
          profile_id: c.profile_id,
          display_name: authorName,
          avatar_url: authorAvatar,

          // legacy keys (keep so existing UI doesn't break):
          id: c.profile_id,
          name: authorName,
        },
      };
    });

    return NextResponse.json({ comments: items });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("unauth") ? 401 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

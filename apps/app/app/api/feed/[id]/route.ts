// app/api/feed/[id]/route.ts
import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getFeedItemById } from "@/lib/feed/queries";
import { setContentVisibility } from "@/lib/feed/commands";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (typeof maybeParams?.then === "function") return await maybeParams;
  return maybeParams;
}

export async function GET(req: Request, context: { params: any }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const resolvedParams = await resolveParams(context?.params);
    const feedItemId = pickFeedItemId(resolvedParams);

    if (!feedItemId || typeof feedItemId !== "string") {
      return NextResponse.json({ error: "Invalid feed item id" }, { status: 400 });
    }

    const item = await getFeedItemById(feedItemId, profileId);
    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    return NextResponse.json({ item }, { headers });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("unauth") ? 401 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * Delete your own post.
 *
 * Soft, via visibility = 'removed', for the same reason moderation is: if the
 * post was reported, the report and the moderation trail have to keep pointing
 * at something. Without this the only way to take down your own bad post is to
 * report yourself and wait for an admin.
 *
 * Author-only, and only for user_post — the generated cards (round_played, pb,
 * hole_event…) are records of what happened, not something you authored.
 */
export async function DELETE(req: Request, context: { params: any }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const resolvedParams = await resolveParams(context?.params);
    const feedItemId = pickFeedItemId(resolvedParams);

    if (!feedItemId || typeof feedItemId !== "string") {
      return NextResponse.json({ error: "Invalid feed item id" }, { status: 400 });
    }

    const { data: row, error } = await supabaseAdmin
      .from("feed_items")
      .select("id, type, actor_profile_id, payload")
      .eq("id", feedItemId)
      .maybeSingle();

    if (error) throw error;
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if ((row as any).actor_profile_id !== profileId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if ((row as any).type !== "user_post") {
      return NextResponse.json({ error: "That card can't be deleted" }, { status: 400 });
    }

    await setContentVisibility({
      actorProfileId: profileId,
      targetType: "feed_item",
      targetId: feedItemId,
      action: "remove",
      reason: "Deleted by author",
    });

    // Purge the photos too. An author deleting their own post means it, and
    // there is no restore path for them — so nothing will ever render these
    // again and they'd otherwise sit in the bucket forever. (A MODERATOR
    // removing a post deliberately does not do this: that action is
    // reversible, and the content may be needed as a record.)
    const paths = postImagePaths((row as any).payload);
    if (paths.length > 0) {
      const { error: rmErr } = await supabaseAdmin.storage.from("post-images").remove(paths);
      // Best effort: the post is already gone from the feed, and failing the
      // request here would tell the author their delete didn't work when it did.
      if (rmErr) console.warn("post-images cleanup failed:", rmErr.message);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = msg.toLowerCase().includes("auth") || msg.toLowerCase().includes("unauth") ? 401 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * Object paths inside the `post-images` bucket for a user_post payload.
 *
 * Covers both the `media[]` shape (full + thumb variants) and the legacy flat
 * `image_urls`. Anything that isn't one of our own public URLs is ignored.
 */
function postImagePaths(payload: any): string[] {
  const marker = "/storage/v1/object/public/post-images/";
  const urls: string[] = [];

  if (Array.isArray(payload?.media)) {
    for (const m of payload.media) {
      if (typeof m?.url === "string") urls.push(m.url);
      if (typeof m?.thumb_url === "string") urls.push(m.thumb_url);
      if (typeof m?.poster_url === "string") urls.push(m.poster_url);
    }
  }
  if (Array.isArray(payload?.image_urls)) {
    for (const u of payload.image_urls) if (typeof u === "string") urls.push(u);
  }

  const paths = new Set<string>();
  for (const url of urls) {
    const idx = url.indexOf(marker);
    if (idx === -1) continue;
    const path = url.slice(idx + marker.length).split("?")[0];
    if (path) paths.add(decodeURIComponent(path));
  }

  return [...paths];
}

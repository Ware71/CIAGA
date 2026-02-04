import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/feed/schemas";
import { getFeedPage } from "@/lib/feed/queries";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;

  // parseInt is safer than Number() for querystrings (e.g. "20abc" -> 20, not NaN)
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;

  return Math.max(min, Math.min(n, max));
}

type TopComment = {
  id: string;
  feed_item_id: string;
  profile_id: string;
  body: string;
  created_at: string;
  like_count: number;
  author: { id: string; name: string; avatar_url: string | null };
};

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const cursorParam = url.searchParams.get("cursor");

    // Always a real integer 1..50
    const limit = clampInt(limitParam, 20, 1, 50);

    const cursor = cursorParam ? decodeFeedCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const page = await getFeedPage({
      viewerProfileId: profileId,
      cursor,
      limit,
    });

    // ---- Enrich: top comment per feed item ---------------------------------
    // Only fetch for items that actually have comments (cheap)
    const idsNeedingTop = (page.items ?? [])
      .filter((it: any) => (it?.aggregates?.comment_count ?? 0) > 0)
      .map((it: any) => it.id)
      .filter(Boolean);

    let topByFeedItemId = new Map<string, TopComment>();

    if (idsNeedingTop.length) {
      const { data: comments, error: cErr } = await supabaseAdmin
        .from("feed_comments")
        .select("id, feed_item_id, profile_id, body, created_at, vote_count")
        .in("feed_item_id", idsNeedingTop);

      if (cErr) throw cErr;

      // Pick best by:
      // 1) vote_count desc
      // 2) created_at desc (most recent wins ties)
      const best = new Map<string, any>();

      for (const c of comments ?? []) {
        const fid = (c as any).feed_item_id as string;
        if (!fid) continue;

        const cur = best.get(fid);
        if (!cur) {
          best.set(fid, c);
          continue;
        }

        const curVotes = typeof (cur as any).vote_count === "number" ? (cur as any).vote_count : 0;
        const nextVotes = typeof (c as any).vote_count === "number" ? (c as any).vote_count : 0;

        if (nextVotes > curVotes) {
          best.set(fid, c);
          continue;
        }

        if (nextVotes === curVotes) {
          const curAt = String((cur as any).created_at ?? "");
          const nextAt = String((c as any).created_at ?? "");
          if (nextAt > curAt) best.set(fid, c);
        }
      }

      const bestComments = Array.from(best.values());
      const profIds = Array.from(
        new Set(bestComments.map((c: any) => c.profile_id).filter(Boolean))
      );

      const profMap = new Map<string, { id: string; name: string; avatar_url: string | null }>();
      if (profIds.length) {
        const { data: profs, error: pErr } = await supabaseAdmin
          .from("profiles")
          .select("id, name, avatar_url")
          .in("id", profIds);

        if (pErr) throw pErr;

        for (const p of profs ?? []) {
          profMap.set((p as any).id, {
            id: (p as any).id,
            name: (p as any).name ?? "Player",
            avatar_url: (p as any).avatar_url ?? null,
          });
        }
      }

      for (const c of bestComments) {
        const fid = (c as any).feed_item_id as string;
        const pid = (c as any).profile_id as string;
        const author = profMap.get(pid) ?? { id: pid, name: "Player", avatar_url: null };

        topByFeedItemId.set(fid, {
          id: (c as any).id,
          feed_item_id: fid,
          profile_id: pid,
          body: String((c as any).body ?? ""),
          created_at: String((c as any).created_at ?? ""),
          like_count: typeof (c as any).vote_count === "number" ? (c as any).vote_count : 0,
          author,
        });
      }
    }

    // Attach to aggregates (no type changes required here; UI can read it as optional)
    const enrichedItems = (page.items ?? []).map((it: any) => {
      const top = topByFeedItemId.get(it.id) ?? null;
      return {
        ...it,
        aggregates: {
          ...(it.aggregates ?? {}),
          top_comment: top,
        },
      };
    });

    return NextResponse.json({
      items: enrichedItems,
      next_cursor: page.next_cursor ? encodeFeedCursor(page.next_cursor) : null,
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const lower = String(msg).toLowerCase();

    const status =
      lower.includes("auth") || lower.includes("unauth")
        ? 401
        : lower.includes("cursor")
          ? 400
          : 400;

    return NextResponse.json({ error: msg }, { status });
  }
}

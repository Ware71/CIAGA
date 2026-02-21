import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/feed/schemas";
import { getProfileFeedPage, type ProfileFeedSort } from "@/lib/feed/profileQueries";
import { ServerTiming } from "@/lib/perf/serverTiming";

export const runtime = "nodejs";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

const VALID_SORTS = new Set<ProfileFeedSort>(["newest", "oldest", "most_interacted"]);

export async function GET(req: Request) {
  try {
    const timing = new ServerTiming();

    const { profileId: viewerProfileId } = await timing.measure("auth", () =>
      getAuthedProfileOrThrow(req)
    );

    const url = new URL(req.url);
    const profileIdParam = url.searchParams.get("profile_id");
    const limitParam = url.searchParams.get("limit");
    const cursorParam = url.searchParams.get("cursor");
    const sortParam = url.searchParams.get("sort") as ProfileFeedSort | null;

    if (!profileIdParam) {
      return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
    }

    const limit = clampInt(limitParam, 20, 1, 50);
    const sort: ProfileFeedSort = sortParam && VALID_SORTS.has(sortParam) ? sortParam : "newest";

    const cursor = cursorParam ? decodeFeedCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const page = await timing.measure("feed", () =>
      getProfileFeedPage({
        subjectProfileId: profileIdParam,
        viewerProfileId,
        cursor,
        limit,
        sort,
      })
    );

    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    timing.applyTo(headers);

    return NextResponse.json(
      {
        items: page.items,
        next_cursor: page.next_cursor ? encodeFeedCursor(page.next_cursor) : null,
      },
      { headers }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const lower = String(msg).toLowerCase();

    const status =
      lower.includes("auth") || lower.includes("unauth")
        ? 401
        : 400;

    return NextResponse.json({ error: msg }, { status });
  }
}

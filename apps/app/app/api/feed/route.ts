import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/feed/schemas";
import { getFeedPage, getLiveRoundsAsFeedItems } from "@/lib/feed/queries";
import { ServerTiming } from "@/lib/perf/serverTiming";

export const runtime = "nodejs";

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;

  // parseInt is safer than Number() for querystrings (e.g. "20abc" -> 20, not NaN)
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;

  return Math.max(min, Math.min(n, max));
}

export async function GET(req: Request) {
  try {
    const timing = new ServerTiming();

    const { profileId } = await timing.measure("auth", () => getAuthedProfileOrThrow(req));

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const cursorParam = url.searchParams.get("cursor");
    const includeLive = url.searchParams.get("include_live") === "1";

    // Always a real integer 1..50
    const limit = clampInt(limitParam, 20, 1, 50);

    const cursor = cursorParam ? decodeFeedCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    // getFeedPage already enriches with top comments via getTopComments() in queries.ts
    const page = await timing.measure("feed", () =>
      getFeedPage({ viewerProfileId: profileId, cursor, limit })
    );

    // Optionally include live round items (first page only)
    let liveItems: any[] | undefined;
    if (includeLive && !cursor) {
      liveItems = await timing.measure("live", () =>
        getLiveRoundsAsFeedItems({ viewerProfileId: profileId })
      );
    }

    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    timing.applyTo(headers);

    return NextResponse.json(
      {
        items: page.items,
        next_cursor: page.next_cursor ? encodeFeedCursor(page.next_cursor) : null,
        ...(includeLive ? { live_items: liveItems ?? [] } : {}),
      },
      { headers }
    );
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

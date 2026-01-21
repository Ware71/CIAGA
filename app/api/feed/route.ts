import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/feed/schemas";
import { getFeedPage } from "@/lib/feed/queries";

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const cursorParam = url.searchParams.get("cursor");

    const limit = Math.max(1, Math.min(Number(limitParam || 20), 50));

    const cursor = cursorParam ? decodeFeedCursor(cursorParam) : null;

    const page = await getFeedPage({
      viewerProfileId: profileId,
      cursor,
      limit,
    });

    return NextResponse.json({
      items: page.items,
      next_cursor: page.next_cursor ? encodeFeedCursor(page.next_cursor) : null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 401 }
    );
  }
}

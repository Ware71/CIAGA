// app/api/feed/[id]/route.ts
import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getFeedItemById } from "@/lib/feed/queries";

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

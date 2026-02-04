import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { createComment } from "@/lib/feed/commands";

type Body = {
  body?: string;
  parent_comment_id?: string | null;
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: feedItemId } = await ctx.params;

    const body = (await req.json()) as Body;

    const result = await createComment({
      feedItemId,
      profileId,
      body: body.body ?? "",
      parentCommentId: body.parent_comment_id ?? null,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";

    // commands.ts throws "Forbidden" if not in feed_item_targets
    if (msg === "Forbidden") {
      return NextResponse.json({ error: msg }, { status: 403 });
    }

    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

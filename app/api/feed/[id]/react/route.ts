import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { setReaction } from "@/lib/feed/commands";

type Body = { emoji?: string };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: feedItemId } = await ctx.params;

    const body = (await req.json()) as Body;
    const emoji = (body.emoji ?? "").trim();
    if (!emoji) throw new Error("Emoji required");

    const result = await setReaction({
      feedItemId,
      profileId,
      emoji,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}

import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getLiveRoundsAsFeedItems } from "@/lib/feed/queries";

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const items = await getLiveRoundsAsFeedItems({ viewerProfileId: profileId });

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 401 }
    );
  }
}

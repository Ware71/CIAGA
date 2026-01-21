import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getLiveMatches } from "@/lib/feed/queries";

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const matches = await getLiveMatches({ viewerProfileId: profileId });

    return NextResponse.json({ matches });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 401 }
    );
  }
}

import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { reportContent } from "@/lib/feed/commands";

type Body = {
  target_type?: "feed_item" | "comment";
  target_id?: string;
  reason?: string;
};

export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = (await req.json()) as Body;

    const targetType = body.target_type;
    const targetId = (body.target_id ?? "").trim();
    const reason = (body.reason ?? "").trim();

    if (targetType !== "feed_item" && targetType !== "comment") {
      throw new Error("Invalid target_type");
    }
    if (!targetId) throw new Error("target_id required");

    const result = await reportContent({
      reporterProfileId: profileId,
      targetType,
      targetId,
      reason,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}

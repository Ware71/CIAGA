import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { createUserPost } from "@/lib/feed/commands";
import type { FeedAudience } from "@/lib/feed/types";

type Body = {
  audience?: FeedAudience;
  text?: string | null;
  image_urls?: string[] | null;
  tagged_profiles?: Array<{ profile_id: string; name: string }> | null;
  tagged_round_id?: string | null;
  tagged_course_id?: string | null;
  tagged_course_name?: string | null;
};

function isFeedAudience(x: any): x is FeedAudience {
  return (
    x === "followers" ||
    x === "public" ||
    x === "private" ||
    x === "match_participants" ||
    x === "custom_list"
  );
}

export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const body = (await req.json()) as Body;

    const audience: FeedAudience = isFeedAudience(body.audience)
      ? body.audience
      : "followers";

    const result = await createUserPost({
      actorProfileId: profileId,
      audience,
      payload: {
        text: body.text ?? null,
        image_urls: Array.isArray(body.image_urls) ? body.image_urls : null,
        tagged_profiles: Array.isArray(body.tagged_profiles)
          ? body.tagged_profiles
          : null,
        tagged_round_id: body.tagged_round_id ?? null,
        tagged_course_id: body.tagged_course_id ?? null,
        tagged_course_name: body.tagged_course_name ?? null,
        created_from: "web",
      },
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}

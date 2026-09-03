import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { createUserPost } from "@/lib/feed/commands";
import type { FeedAudience, FeedMedia } from "@/lib/feed/types";

type Body = {
  audience?: FeedAudience;
  text?: string | null;
  media?: FeedMedia[] | null;
  /** Legacy: pre-`media` clients. parseFeedPayload validates either. */
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
        // Both go through parseFeedPayload, which drops any URL that isn't in
        // our own public post-images bucket and derives image_urls from media.
        media: Array.isArray(body.media) ? body.media : null,
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

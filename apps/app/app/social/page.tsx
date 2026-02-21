import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getFeedPage, getLiveRoundsAsFeedItems } from "@/lib/feed/queries";
import { encodeFeedCursor } from "@/lib/feed/schemas";
import SocialClient from "./SocialClient";

export default async function SocialPage() {
  const viewerResult = await getServerViewer();
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  const [feedPage, liveItems] = await Promise.all([
    getFeedPage({ viewerProfileId: viewer.profileId, limit: 20 }),
    getLiveRoundsAsFeedItems({ viewerProfileId: viewer.profileId }),
  ]);

  return (
    <SocialClient
      initialFeedData={{
        items: feedPage.items,
        liveItems,
        nextCursor: feedPage.next_cursor ? encodeFeedCursor(feedPage.next_cursor) : null,
      }}
    />
  );
}

import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getFeedPage, getLiveRoundsAsFeedItems } from "@/lib/feed/queries";
import { encodeFeedCursor } from "@/lib/feed/schemas";
import SocialClient from "./SocialClient";

export default async function SocialPage() {
  const viewer = await getServerViewer();
  if (!viewer) redirect("/auth");

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

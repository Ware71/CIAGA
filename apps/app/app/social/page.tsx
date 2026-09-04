import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getFeedPage, getLiveRoundsAsFeedItems } from "@/lib/feed/queries";
import { encodeFeedCursor } from "@/lib/feed/schemas";
import SocialClient, { type InitialFeedData } from "./SocialClient";

export const metadata: Metadata = { title: "Social" };

async function loadInitialFeed(profileId: string): Promise<InitialFeedData> {
  const [feedPage, liveItems] = await Promise.all([
    getFeedPage({ viewerProfileId: profileId, limit: 20 }),
    getLiveRoundsAsFeedItems({ viewerProfileId: profileId }),
  ]);

  return {
    items: feedPage.items,
    liveItems,
    nextCursor: feedPage.next_cursor ? encodeFeedCursor(feedPage.next_cursor) : null,
  };
}

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const [viewerResult, sp] = await Promise.all([getServerViewer(), searchParams]);
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  // Deliberately NOT awaited. SocialClient renders the header and the compose
  // button straight away and unwraps this inside a Suspense boundary, so the
  // page has chrome on screen while Postgres is still answering instead of
  // holding the whole document back for it.
  const feedPromise = loadInitialFeed(viewer.profileId);

  return <SocialClient focusId={sp?.focus ?? null} initialFeedPromise={feedPromise} />;
}

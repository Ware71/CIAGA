import { notFound, redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getFeedItemById } from "@/lib/feed/queries";
import { getFeedItemDetail } from "@/lib/feed/detail";
import SocialDetailClient from "./SocialDetailClient";

export default async function SocialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [viewerResult, { id }] = await Promise.all([getServerViewer(), params]);
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  const item = await getFeedItemById(id, viewer.profileId);
  if (!item) notFound();

  const detail = await getFeedItemDetail(item);

  return <SocialDetailClient item={item} detail={detail} />;
}

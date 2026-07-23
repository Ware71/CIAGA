import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import RoundDetailClient from "./RoundDetailClient";

export const metadata: Metadata = { title: "Scorecard" };

export default async function RoundDetailPage({ params }: { params: Promise<{ round_id: string }> }) {
  const [viewerResult, { round_id: roundId }] = await Promise.all([
    getServerViewer(),
    params,
  ]);
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  const { data, error } = await supabaseAdmin.rpc("get_round_detail_snapshot", { _round_id: roundId });

  if (error || !data?.round) {
    // Fall back to client-side fetch
    return <RoundDetailClient roundId={roundId} />;
  }

  // Draft & scheduled rounds render the scorecard in PREVIEW mode (the round only
  // goes live on the first score entry). The client falls back to a "Go to setup"
  // panel when no tee has been chosen yet, so no redirect is needed here.

  const initialSnapshot = { ...data, viewer_profile_id: viewer.profileId };

  return <RoundDetailClient roundId={roundId} initialSnapshot={initialSnapshot} />;
}

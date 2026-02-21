import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import RoundDetailClient from "./RoundDetailClient";

export default async function RoundDetailPage({ params }: { params: Promise<{ round_id: string }> }) {
  const [viewer, { round_id: roundId }] = await Promise.all([
    getServerViewer(),
    params,
  ]);
  if (!viewer) redirect("/auth");

  const { data, error } = await supabaseAdmin.rpc("get_round_detail_snapshot", { _round_id: roundId });

  if (error || !data?.round) {
    // Fall back to client-side fetch
    return <RoundDetailClient roundId={roundId} />;
  }

  // Redirect draft rounds to setup
  if (data.round.status === "draft") {
    redirect(`/round/${roundId}/setup`);
  }

  const initialSnapshot = { ...data, viewer_profile_id: viewer.profileId };

  return <RoundDetailClient roundId={roundId} initialSnapshot={initialSnapshot} />;
}

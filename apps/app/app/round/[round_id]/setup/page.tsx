import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getSetupSnapshot } from "@/lib/rounds/getSetupSnapshot";
import SetupClient from "./SetupClient";

export default async function SetupPage({ params }: { params: Promise<{ round_id: string }> }) {
  const [viewerResult, { round_id: roundId }] = await Promise.all([
    getServerViewer(),
    params,
  ]);
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  let initialSnapshot: any = undefined;
  try {
    const data = await getSetupSnapshot(roundId);
    if (data) {
      // Redirect live rounds to the round detail page
      if (data.round?.status === "live") {
        redirect(`/round/${roundId}`);
      }
      initialSnapshot = data;
    }
  } catch {
    // Fall back to client-side fetch
  }

  return (
    <SetupClient
      roundId={roundId}
      initialSnapshot={initialSnapshot}
      viewerProfileId={viewer.profileId}
    />
  );
}

import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getSetupSnapshot } from "@/lib/rounds/getSetupSnapshot";
import SetupClient from "./SetupClient";

export default async function SetupPage({ params }: { params: Promise<{ round_id: string }> }) {
  const [viewer, { round_id: roundId }] = await Promise.all([
    getServerViewer(),
    params,
  ]);
  if (!viewer) redirect("/auth");

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

import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getHomeSummary, type HomeSummary } from "@/lib/home/getHomeSummary";
import CIAGAStarter from "./CiagaStarter";

export default async function Page() {
  const viewerResult = await getServerViewer();
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  const initialData = await getHomeSummary(viewer.profileId);

  return <CIAGAStarter initialData={initialData} />;
}

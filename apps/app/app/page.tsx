import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getHomeSummary } from "@/lib/home/getHomeSummary";
import { getMajorHubSummary } from "@/lib/majors/queries";
import CIAGAStarter from "./CiagaStarter";

export default async function Page() {
  const viewerResult = await getServerViewer();
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  const [initialData, initialMajors] = await Promise.all([
    getHomeSummary(viewer.profileId),
    getMajorHubSummary(viewer.profileId),
  ]);

  return <CIAGAStarter initialData={initialData} initialMajors={initialMajors} />;
}

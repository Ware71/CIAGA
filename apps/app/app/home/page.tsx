import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getHomeSummary } from "@/lib/home/getHomeSummary";
import { getMajorHubSummary } from "@/lib/majors/queries";
import HomeClient from "./HomeClient";

export default async function Page() {
  const viewerResult = await getServerViewer();
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");

  const [initialData, initialMajors] = await Promise.all([
    getHomeSummary(viewerResult.viewer.profileId),
    getMajorHubSummary(viewerResult.viewer.profileId),
  ]);

  return <HomeClient initialData={initialData} initialMajors={initialMajors} />;
}

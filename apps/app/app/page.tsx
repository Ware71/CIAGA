import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getHomeSummary, type HomeSummary } from "@/lib/home/getHomeSummary";
import CIAGAStarter from "./CiagaStarter";

export default async function Page() {
  const viewer = await getServerViewer();
  if (!viewer) redirect("/auth");

  const initialData = await getHomeSummary(viewer.profileId);

  return <CIAGAStarter initialData={initialData} />;
}

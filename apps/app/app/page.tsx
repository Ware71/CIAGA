import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import CIAGAStarter from "./CiagaStarter";

export default async function Page() {
  const viewerResult = await getServerViewer();
  if (viewerResult.status === "signed_out") redirect("/auth");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");

  return <CIAGAStarter />;
}

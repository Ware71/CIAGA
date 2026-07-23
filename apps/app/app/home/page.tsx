import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getHomeSummary } from "@/lib/home/getHomeSummary";
import { getMajorHubSummary } from "@/lib/majors/queries";
import HomeClient from "./HomeClient";

export const metadata: Metadata = { title: "Home" };

/**
 * Home used to be a bare `<HomeClient />`, which meant the first screen after
 * sign-in resolved the session client-side (auth user + session + profile
 * lookup), then fetched `?part=core`, then `?part=feed` and `/api/majors/hub` —
 * four sequential waves from the phone, hidden behind the splash screen.
 *
 * All of that data is reachable server-side, where it's one hop from Postgres
 * instead of a round trip from a phone on course wifi. Fetch it here, hand it to
 * the client as props, and the splash has nothing left to hide.
 *
 * The client keeps its own fetch path for the no-props case (and for the
 * back-navigation cache), so this is additive.
 */
export default async function HomePage() {
  const viewerResult = await getServerViewer();
  if (viewerResult.status === "signed_out") redirect("/auth?next=%2Fhome");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  // Concurrent, not sequential — the whole point of moving this server-side.
  // Majors is best-effort: a hub failure shouldn't take down the home screen,
  // and the client's MajorsHubPreview self-fetches as a fallback.
  const [summary, majors] = await Promise.all([
    getHomeSummary(viewer.profileId),
    getMajorHubSummary(viewer.profileId).catch(() => null),
  ]);

  return (
    <HomeClient
      initialData={summary}
      initialMajors={majors}
      initialProfileId={viewer.profileId}
    />
  );
}

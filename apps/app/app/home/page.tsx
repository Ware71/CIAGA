import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getHomeCore, getHomeMiniFeed } from "@/lib/home/getHomeSummary";
import { getMajorHubSummary } from "@/lib/majors/queries";
import HomeClient from "./HomeClient";

export const metadata: Metadata = { title: "Home" };

/**
 * Home STREAMS its data rather than blocking on it. The server component awaits
 * only the session (needed for the redirect), then hands HomeClient the home
 * queries as pending promises. React flushes the HTML shell immediately — so the
 * splash mounts right away and plays its connection-aware wait animation (grow →
 * pulse → spin on a slow link, quick grow → exit on a fast one) — while the data
 * streams in behind it. Core gates the splash; feed + Majors fill in after.
 *
 * This keeps the fetches server-side (one hop from Postgres, no client waterfall)
 * WITHOUT a blocking `await`. Awaiting here froze the splash into an instant
 * grow→exit and dropped its pulse/spin, because the data was already present when
 * LoadingScreen mounted. HomeClient keeps its own client-fetch path as the
 * fallback for when the promises are absent (or a retry).
 */
export default async function HomePage() {
  const viewerResult = await getServerViewer();
  if (viewerResult.status === "signed_out") redirect("/auth?next=%2Fhome");
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  // Wrapped so a rejection can't surface as an unhandled RSC error — HomeClient
  // reads the {ok} shape and falls back to its retry path on failure.
  const initialCore = getHomeCore(viewer.profileId)
    .then((data) => ({ ok: true as const, data }))
    .catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));

  // Low priority — never gates the splash. Best-effort: a failure yields null and
  // the client's self-fetch fallbacks cover it.
  const initialRest = Promise.all([
    getHomeMiniFeed(viewer.profileId).catch(() => null),
    getMajorHubSummary(viewer.profileId).catch(() => null),
  ]);

  return (
    <HomeClient
      initialCore={initialCore}
      initialRest={initialRest}
      initialProfileId={viewer.profileId}
    />
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServerViewer } from "@/lib/supabaseServer";
import { getEventDetailSnapshot } from "@/lib/majors/getEventDetailSnapshot";
import EventDetailClient from "./EventDetailClient";

export const metadata: Metadata = { title: "Event" };

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [viewerResult, { id }] = await Promise.all([getServerViewer(), params]);
  if (viewerResult.status === "signed_out") {
    redirect(`/auth?next=${encodeURIComponent(`/majors/events/${id}`)}`);
  }
  if (viewerResult.status === "needs_onboarding") redirect("/onboarding/set-password");
  const viewer = viewerResult.viewer;

  // Build the whole first paint server-side. On failure, fall through to the
  // client fetch path rather than erroring the page — same fallback contract as
  // app/round/[round_id]/page.tsx. `null` specifically means "no such event".
  const snapshot = await getEventDetailSnapshot(id, viewer.profileId).catch(() => undefined);
  if (snapshot === null) notFound();

  return <EventDetailClient eventId={id} initialSnapshot={snapshot} />;
}

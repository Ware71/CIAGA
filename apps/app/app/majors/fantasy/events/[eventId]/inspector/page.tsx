import type { Metadata } from "next";
import { Suspense } from "react";
import InspectorClient from "./InspectorClient";

export const metadata: Metadata = { title: "Odds Inspector" };

export default async function FantasyInspectorPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return (
    <Suspense>
      <InspectorClient eventId={eventId} />
    </Suspense>
  );
}

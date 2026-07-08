import type { Metadata } from "next";
import { Suspense } from "react";
import EventMarketsClient from "./EventMarketsClient";

export const metadata: Metadata = { title: "Fantasy Markets" };

export default async function FantasyEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return (
    <Suspense>
      <EventMarketsClient eventId={eventId} />
    </Suspense>
  );
}

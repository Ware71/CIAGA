import type { Metadata } from "next";
import EventDetailClient from "./EventDetailClient";

export const metadata: Metadata = { title: "Event" };

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailClient eventId={id} />;
}

import type { Metadata } from "next";
import EventHistoryClient from "./EventHistoryClient";

export const metadata: Metadata = { title: "Event History" };

export default async function EventHistoryPage({ params }: { params: Promise<{ eventTemplateId: string }> }) {
  const { eventTemplateId } = await params;
  return <EventHistoryClient eventTemplateId={eventTemplateId} />;
}

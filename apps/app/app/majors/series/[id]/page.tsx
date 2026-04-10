import type { Metadata } from "next";
import SeriesDetailClient from "./SeriesDetailClient";

export const metadata: Metadata = { title: "Series" };

export default async function SeriesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeriesDetailClient seriesId={id} />;
}

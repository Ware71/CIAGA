import type { Metadata } from "next";
import SeasonDetailClient from "./SeasonDetailClient";

export const metadata: Metadata = { title: "Season" };

export default async function SeasonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeasonDetailClient seasonId={id} />;
}

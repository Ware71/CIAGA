import type { Metadata } from "next";
import CompetitionDetailClient from "./CompetitionDetailClient";

export const metadata: Metadata = { title: "Competition" };

export default async function CompetitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompetitionDetailClient competitionId={id} />;
}

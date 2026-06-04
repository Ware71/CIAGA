import type { Metadata } from "next";
import GroupSeasonDetailClient from "./GroupSeasonDetailClient";

export const metadata: Metadata = { title: "Season" };

export default async function GroupSeasonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupSeasonDetailClient groupSeasonId={id} />;
}

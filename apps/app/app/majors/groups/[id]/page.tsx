import type { Metadata } from "next";
import GroupDetailClient from "./GroupDetailClient";

export const metadata: Metadata = { title: "Group" };

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupDetailClient groupId={id} />;
}

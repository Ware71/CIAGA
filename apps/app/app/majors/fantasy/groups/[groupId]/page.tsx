import type { Metadata } from "next";
import { Suspense } from "react";
import GroupMarketsClient from "./GroupMarketsClient";

export const metadata: Metadata = { title: "Fantasy Markets" };

export default async function FantasyGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  return (
    <Suspense>
      <GroupMarketsClient groupId={groupId} />
    </Suspense>
  );
}

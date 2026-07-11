import type { Metadata } from "next";
import { Suspense } from "react";
import SeasonBoardClient from "./SeasonBoardClient";

export const metadata: Metadata = { title: "Season Markets" };

export default async function FantasySeasonPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return (
    <Suspense>
      <SeasonBoardClient seasonId={seasonId} />
    </Suspense>
  );
}

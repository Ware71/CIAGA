import type { Metadata } from "next";
import { Suspense } from "react";
import LeaderboardClient from "./LeaderboardClient";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardClient />
    </Suspense>
  );
}

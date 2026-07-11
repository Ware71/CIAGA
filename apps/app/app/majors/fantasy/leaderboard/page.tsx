import type { Metadata } from "next";
import FantasyLeaderboardClient from "./FantasyLeaderboardClient";

export const metadata: Metadata = { title: "Fantasy Leaderboard" };

export default function FantasyLeaderboardPage() {
  return <FantasyLeaderboardClient />;
}

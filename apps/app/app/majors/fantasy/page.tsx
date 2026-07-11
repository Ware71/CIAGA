import type { Metadata } from "next";
import FantasyHubClient from "./FantasyHubClient";

export const metadata: Metadata = { title: "Fantasy Picks" };

export default function FantasyHubPage() {
  return <FantasyHubClient />;
}

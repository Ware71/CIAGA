import type { Metadata } from "next";
import MyPicksClient from "./MyPicksClient";

export const metadata: Metadata = { title: "My Picks" };

export default function MyPicksPage() {
  return <MyPicksClient />;
}

import type { Metadata } from "next";
import PlayClient from "./PlayClient";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return <PlayClient />;
}

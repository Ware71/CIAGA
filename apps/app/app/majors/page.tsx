import type { Metadata } from "next";
import MajorsHubClient from "./MajorsHubClient";

export const metadata: Metadata = { title: "Majors Hub" };

export default function MajorsHubPage() {
  return <MajorsHubClient />;
}

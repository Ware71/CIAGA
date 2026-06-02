import type { Metadata } from "next";
import CreateCompetitionClient from "./CreateCompetitionClient";

export const metadata: Metadata = { title: "Create Competition" };

export default function CreateCompetitionPage() {
  return <CreateCompetitionClient />;
}

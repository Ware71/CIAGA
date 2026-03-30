import type { Metadata } from "next";
import { Suspense } from "react";
import CreateCompetitionClient from "./CreateCompetitionClient";

export const metadata: Metadata = { title: "Create Competition" };

export default function CreateCompetitionPage() {
  return (
    <Suspense>
      <CreateCompetitionClient />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import CreateEventClient from "./CreateEventClient";

export const metadata: Metadata = { title: "Create Event" };

export default function CreateEventPage() {
  return (
    <Suspense>
      <CreateEventClient />
    </Suspense>
  );
}

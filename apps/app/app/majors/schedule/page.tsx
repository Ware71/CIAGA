import type { Metadata } from "next";
import { Suspense } from "react";
import ScheduleClient from "./ScheduleClient";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage() {
  // ScheduleClient reads ?filter (set by the /majors/history redirect), and
  // useSearchParams needs a Suspense boundary or the route opts out of static.
  return (
    <Suspense fallback={<div className="min-h-[100dvh]" />}>
      <ScheduleClient />
    </Suspense>
  );
}

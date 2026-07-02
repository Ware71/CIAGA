// /app/calendar/page.tsx
import { Suspense } from "react";
import { CalendarClient } from "@/components/calendar/CalendarClient";

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#042713]" />}>
      <CalendarClient />
    </Suspense>
  );
}

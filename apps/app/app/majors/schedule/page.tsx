import type { Metadata } from "next";
import ScheduleClient from "./ScheduleClient";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage() {
  return <ScheduleClient />;
}

import { redirect } from "next/navigation";

/**
 * Merged into /majors/schedule, which now shows fixtures and results together.
 * Kept as a redirect because notifications and older links still point here.
 */
export default function MajorsHistoryPage() {
  redirect("/majors/schedule?filter=completed");
}

import { redirect } from "next/navigation";

/**
 * The rounds list moved to /play when that took the 4th nav tab. Kept as a
 * redirect rather than deleted: notifications, bookmarks and the installed PWA's
 * history all still point here.
 */
export default function RoundIndexPage() {
  redirect("/play");
}

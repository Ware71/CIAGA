import type { Metadata } from "next";
import { getMajorHubSummary } from "@/lib/majors/queries";
import { cookies } from "next/headers";
import MajorsHubClient from "./MajorsHubClient";
import type { MajorHubSummary } from "@/lib/majors/types";

export const metadata: Metadata = { title: "Majors Hub" };

export default async function MajorsHubPage() {
  let initialData: MajorHubSummary | null = null;

  try {
    // Try to get server-side profile from session
    const { createServerClient } = await import("@supabase/ssr");
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { getOwnedProfileIdOrThrow } = await import("@/lib/serverOwnedProfile");
      const profileId = await getOwnedProfileIdOrThrow(user.id);
      initialData = await getMajorHubSummary(profileId);
    }
  } catch {
    // client will fetch on mount
  }

  return <MajorsHubClient initialData={initialData} />;
}

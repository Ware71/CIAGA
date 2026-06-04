import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import CreateGroupClient from "./CreateGroupClient";

export const metadata: Metadata = { title: "Create Group" };

export default async function CreateGroupPage() {
  try {
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
    if (!user) redirect("/auth");

    const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
    const { getOwnedProfileIdOrThrow } = await import("@/lib/serverOwnedProfile");
    const profileId = await getOwnedProfileIdOrThrow(user.id);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", profileId)
      .maybeSingle();

    if (!(profile as any)?.is_admin) redirect("/majors");
  } catch {
    redirect("/majors");
  }

  return <CreateGroupClient />;
}

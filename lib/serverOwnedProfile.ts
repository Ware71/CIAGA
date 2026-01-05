// /lib/serverOwnedProfile.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Server-side: resolve the canonical profiles.id for an authenticated auth.users.id.
 * Throws if no owned profile exists.
 */
export async function getOwnedProfileIdOrThrow(authUserId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("owner_user_id", authUserId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) throw new Error("No owned profile found for this auth user.");
  return data.id as string;
}

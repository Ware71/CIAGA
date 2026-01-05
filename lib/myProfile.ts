// /lib/myProfile.ts
import { supabase } from "@/lib/supabaseClient";

export type Profile = {
  id: string;
  owner_user_id: string | null;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin?: boolean | null;
};

/**
 * Fetch the profile row owned by the given auth user id.
 * Model B: profiles.id is the canonical "player id"; profiles.owner_user_id links to auth.users.id.
 */
export async function getMyProfileByAuthUserId(authUserId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, owner_user_id, name, email, avatar_url, is_admin")
    .eq("owner_user_id", authUserId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No profile found for this user (owner_user_id missing).");
  return data as any;
}

export async function getMyProfileIdByAuthUserId(authUserId: string): Promise<string> {
  const p = await getMyProfileByAuthUserId(authUserId);
  return p.id;
}

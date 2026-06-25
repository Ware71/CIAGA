import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type Caller = {
  authUserId: string;
  email: string;
  profileId: string;
  isAdmin: boolean;
};

/**
 * Resolve the authenticated caller (and their owned profile) from a Bearer token.
 * Uses the service-role client to read the profile; callers should still gate actions
 * by ownership/admin as needed.
 */
export async function getCaller(
  req: Request
): Promise<{ ok: true; caller: Caller } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { ok: false, status: 401, error: "Missing bearer token" };

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, status: 401, error: "Unauthorized" };

  const authUser = userData.user;

  const { data: prof, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id, is_admin")
    .eq("owner_user_id", authUser.id)
    .maybeSingle();

  if (profErr) return { ok: false, status: 500, error: profErr.message };
  if (!prof) return { ok: false, status: 400, error: "Profile not found for user" };

  return {
    ok: true,
    caller: {
      authUserId: authUser.id,
      email: (authUser.email || "").trim().toLowerCase(),
      profileId: prof.id,
      isAdmin: !!prof.is_admin,
    },
  };
}

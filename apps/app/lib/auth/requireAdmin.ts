import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Verifies the caller is an authenticated admin (profiles.is_admin via the
 * owner_user_id model) and returns their profile id. Throws "Missing bearer
 * token" / "Unauthorized" / "Forbidden" which callers map to 401/403.
 */
export async function requireAdminProfile(req: Request): Promise<{ adminProfileId: string }> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new Error("Missing bearer token");

  const { data: userData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !userData?.user) throw new Error("Unauthorized");

  const { data: rows, error: adminErr } = await supabaseAdmin
    .from("profiles")
    .select("id, is_admin")
    .eq("owner_user_id", userData.user.id)
    .limit(1);

  if (adminErr) throw new Error(adminErr.message);
  if (!rows?.[0]?.is_admin) throw new Error("Forbidden");

  return { adminProfileId: rows[0].id };
}

export function adminErrorStatus(msg: string): number {
  const m = msg.toLowerCase();
  if (m === "forbidden") return 403;
  if (m.includes("auth") || m.includes("token") || m === "unauthorized") return 401;
  return 500;
}

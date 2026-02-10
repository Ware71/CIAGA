import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

export type AuthedContext = {
  /** The raw bearer token sent by the client */
  token: string;
  /** auth.users.id */
  authUserId: string;
  /** profiles.id (owned profile for this auth user) */
  profileId: string;
};

function readBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return token && token.trim() ? token.trim() : null;
}

/**
 * Server-side helper for API routes:
 * - validates Authorization: Bearer <token>
 * - resolves auth user via Supabase
 * - resolves owned profiles.id
 */
export async function getAuthedProfileOrThrow(req: Request): Promise<AuthedContext> {
  const token = readBearerToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) throw new Error("Unauthorized");

  const authUserId = userData.user.id;
  const profileId = await getOwnedProfileIdOrThrow(authUserId);

  return { token, authUserId, profileId };
}

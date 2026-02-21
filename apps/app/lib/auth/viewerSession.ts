import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";

export type ViewerSession = {
  authUserId: string;
  profileId: string;
  accessToken: string;
};

let cached: Promise<ViewerSession | null> | null = null;

/**
 * Resolve the current viewer's auth user id, profile id, and access token.
 *
 * The result is memoised as a single in-flight promise so parallel callers
 * (e.g. multiple useEffect hooks on mount) share one set of network
 * round-trips instead of each making their own.
 *
 * The cache is automatically invalidated on any Supabase auth state change.
 */
export function getViewerSession(): Promise<ViewerSession | null> {
  if (cached) return cached;

  cached = resolveSession();
  // If the promise rejects, clear the cache so the next caller retries.
  cached.catch(() => {
    cached = null;
  });

  return cached;
}

export function invalidateViewerSession(): void {
  cached = null;
}

async function resolveSession(): Promise<ViewerSession | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;

  const profileId = await getMyProfileIdByAuthUserId(user.id);
  return { authUserId: user.id, profileId, accessToken: token };
}

// Invalidate whenever the auth state changes (sign-in, sign-out, token refresh).
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange(() => {
    invalidateViewerSession();
  });
}

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

/**
 * Create a cookie-based Supabase client for use in server components
 * and server-side route handlers. Uses the anon key so RLS applies.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — cookies are read-only.
            // The middleware handles token refresh via setAll.
          }
        },
      },
    }
  );
}

export type ServerViewerSession = {
  authUserId: string;
  profileId: string;
};

/**
 * Resolve the current viewer from cookies. Returns null if not signed in.
 * For use in server components and server actions.
 */
export async function getServerViewer(): Promise<ServerViewerSession | null> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  try {
    const profileId = await getOwnedProfileIdOrThrow(user.id);
    return { authUserId: user.id, profileId };
  } catch {
    return null;
  }
}

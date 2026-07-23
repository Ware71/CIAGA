import { getViewerSession, type ViewerSession } from "@/lib/auth/viewerSession";

/**
 * Resolve the viewer session, or send the user to sign in.
 *
 * Client components used to do:
 *
 *     const session = await getViewerSession();
 *     if (!session) return;            // ← silently does nothing
 *
 * which leaves the page blank on load and makes buttons dead on click. Since
 * `getViewerSession()` memoises one promise and only invalidates on a Supabase
 * auth-state change, a backgrounded PWA tab with an expired token lands here
 * routinely and the user has no idea why nothing happens.
 *
 * `requireViewerSession()` keeps the caller's control flow identical — it still
 * resolves to null and the caller still bails — but it also routes to /auth with
 * a `next` back to where the user was.
 *
 * The redirect is a full document navigation rather than a router push. The
 * session is gone, so every in-memory cache keyed to the old viewer (the
 * memoised session promise, the home data cache, any loaded page state) is
 * stale; a document load drops all of it instead of carrying it into the next
 * sign-in.
 *
 * Deliberately not a hook, so it can be dropped into existing async callbacks
 * and effects without restructuring them or touching dependency arrays.
 */
export async function requireViewerSession(): Promise<ViewerSession | null> {
  const session = await getViewerSession();
  if (session) return session;

  if (typeof window !== "undefined") {
    const { pathname, search } = window.location;
    const here = `${pathname}${search}`;
    const target =
      pathname && pathname !== "/auth"
        ? `/auth?next=${encodeURIComponent(here)}`
        : "/auth";
    // Guard against redirect loops if several callers race on the same tick.
    if (!window.location.pathname.startsWith("/auth")) {
      window.location.assign(target);
    }
  }

  return null;
}

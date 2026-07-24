import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — reads and potentially writes cookies.
  //
  // getClaims(), not getUser(): getUser() sends a request to the Auth server on
  // EVERY request through this matcher (documents, RSC payloads, API routes),
  // and that hop sits in front of the first byte of HTML — it was a visible
  // chunk of the cold-start blank window. getClaims() still calls getSession()
  // internally, so an expired token is refreshed and the new cookies are still
  // written through setAll above; it just verifies the JWT locally against the
  // cached JWKS instead of asking the server to do it. On a project using
  // symmetric (HS256) signing keys it falls back to getUser(), i.e. exactly the
  // previous behaviour.
  //
  // This middleware only refreshes tokens — it never redirects or gates access.
  // Authorisation stays where it was: getServerViewer() in server components and
  // the Bearer checks in the API routes.
  await supabase.auth.getClaims();

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|manifest|json|js|css)$).*)",
  ],
};

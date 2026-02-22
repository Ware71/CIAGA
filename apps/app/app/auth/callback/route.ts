import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function sanitizeNextPath(rawNext: string | null, fallback: string) {
  if (!rawNext) return fallback;
  return rawNext.startsWith("/") ? rawNext : fallback;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  const fallbackNext =
    type === "recovery"
      ? "/auth?recovery=true"
      : type === "invite"
        ? "/onboarding/set-password"
        : "/";
  const nextPath = sanitizeNextPath(url.searchParams.get("next"), fallbackNext);

  const response = NextResponse.redirect(new URL(nextPath, url.origin));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as
        | "recovery"
        | "invite"
        | "magiclink"
        | "signup"
        | "email"
        | "email_change",
      token_hash: tokenHash,
    });
    if (!error) return response;
  }

  const authError = type === "recovery" ? "recovery_expired" : "invite_expired";
  return NextResponse.redirect(new URL(`/auth?error=${authError}`, url.origin));
}

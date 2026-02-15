import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";

  // Exchange the auth code for a session if present
  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if this is a recovery flow by looking at the type parameter
      const type = url.searchParams.get("type");
      if (type === "recovery") {
        return NextResponse.redirect(new URL("/auth?recovery=true", url.origin));
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

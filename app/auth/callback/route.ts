import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/";

  // For many email-link flows, Supabase uses code-based flow or token in URL.
  // If you're using @supabase/ssr, use its recommended callback handler.
  // For a quick start, just redirect to a client page that calls supabase.auth.getSession().
  return NextResponse.redirect(new URL(next, url.origin));
}

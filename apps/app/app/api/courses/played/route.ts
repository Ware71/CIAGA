import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

/**
 * GET — courses the viewer has finished a round at, newest first.
 *
 * Thin wrapper over `courses_played_by_profile`, which counts every finished
 * round rather than only WHS-accepted ones: a casual knock still means you have
 * played there, and filtering it out would make courses look missing.
 *
 * Server-side so the profile id is the caller's own and can't be spoofed by
 * passing someone else's to the RPC.
 */
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const { data, error } = await supabaseAdmin.rpc("courses_played_by_profile", {
      p_profile_id: profileId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ items: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unauthorised" }, { status: 401 });
  }
}

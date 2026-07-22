import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCaller } from "@/lib/server/auth";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";

/** Whether the caller still needs to accept the current Terms version. */
export async function GET(req: Request) {
  try {
    const auth = await getCaller(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("terms_version")
      .eq("id", auth.caller.profileId)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const needsAcceptance = (data?.terms_version ?? null) !== CURRENT_TERMS_VERSION;
    return NextResponse.json({ needsAcceptance, currentVersion: CURRENT_TERMS_VERSION });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

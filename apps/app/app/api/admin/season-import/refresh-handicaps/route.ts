import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Runs one batch of the cursor-based handicap replay (see
// ciaga_refresh_handicaps_step). The season-import UI loops this endpoint
// until `remaining` reaches 0 — a single RPC covering a multi-season replay
// exceeds the DB statement timeout.
//
// JSON body:
//   from_date  — replay cutoff (YYYY-MM-DD), wipe happens on the first call
//   after_ts   — cursor from the previous batch (null on first call)
//   after_id   — cursor from the previous batch (null on first call)
//   max_rounds — optional batch size (default 10)

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing Authorization token" }, { status: 401 });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { data: myProfile, error: pErr } = await admin
      .from("profiles")
      .select("id,is_admin")
      .eq("owner_user_id", userRes.user.id)
      .single();

    if (pErr) throw new Error(pErr.message);
    if (!myProfile?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const fromDate = body?.from_date as string | undefined;
    if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      return NextResponse.json({ error: "from_date must be YYYY-MM-DD" }, { status: 400 });
    }

    const { data, error } = await admin.rpc("ciaga_refresh_handicaps_step", {
      p_from_date: fromDate,
      p_after_ts: body?.after_ts ?? null,
      p_after_id: body?.after_id ?? null,
      p_max_rounds: typeof body?.max_rounds === "number" ? body.max_rounds : 10,
    });
    if (error) throw new Error(`Handicap refresh step failed: ${error.message}`);

    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

// /app/api/rounds/[round_id]/starting-hole/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  hole_number?: number | "auto";
};

export async function PATCH(req: Request, { params }: { params: Promise<{ round_id: string }> }) {
  try {
    const { round_id: roundId } = await params;
    if (!roundId) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const myProfileId = await getOwnedProfileIdOrThrow(userData.user.id);
    const body = (await req.json()) as Body;

    if (body.hole_number === undefined) {
      return NextResponse.json({ error: "Missing hole_number" }, { status: 400 });
    }

    // Any participant may correct the starting hole — same permission model as scoring.
    const [{ data: me, error: meErr }, { data: round, error: roundErr }] = await Promise.all([
      supabaseAdmin
        .from("round_participants")
        .select("id")
        .eq("round_id", roundId)
        .eq("profile_id", myProfileId)
        .maybeSingle(),
      supabaseAdmin.from("rounds").select("status").eq("id", roundId).single(),
    ]);

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me) return NextResponse.json({ error: "Not a participant in this round" }, { status: 403 });
    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });
    if (round.status === "finished") {
      return NextResponse.json({ error: "Round is finished — starting hole can no longer be changed" }, { status: 400 });
    }

    if (body.hole_number === "auto") {
      const { data: minRow, error: minErr } = await supabaseAdmin
        .from("round_hole_states")
        .select("hole_number")
        .eq("round_id", roundId)
        .in("status", ["completed", "picked_up"])
        .order("hole_number", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (minErr) return NextResponse.json({ error: minErr.message }, { status: 500 });

      const { error: updateErr } = await supabaseAdmin
        .from("rounds")
        .update({ starting_hole: minRow?.hole_number ?? 1, starting_hole_source: "auto" })
        .eq("id", roundId);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, round_id: roundId });
    }

    const holeNumber = Number(body.hole_number);
    if (!Number.isInteger(holeNumber)) {
      return NextResponse.json({ error: "hole_number must be an integer or \"auto\"" }, { status: 400 });
    }

    // Determine hole count for this round (falls back to 18 if no tee snapshot yet).
    const { data: teeRow } = await supabaseAdmin
      .from("round_participants")
      .select("tee_snapshot_id")
      .eq("round_id", roundId)
      .not("tee_snapshot_id", "is", null)
      .limit(1)
      .maybeSingle();

    let holeCount = 18;
    if (teeRow?.tee_snapshot_id) {
      const { count } = await supabaseAdmin
        .from("round_hole_snapshots")
        .select("hole_number", { count: "exact", head: true })
        .eq("round_tee_snapshot_id", teeRow.tee_snapshot_id);
      if (typeof count === "number" && count > 0) holeCount = count;
    }

    if (holeNumber < 1 || holeNumber > holeCount) {
      return NextResponse.json({ error: `hole_number must be between 1 and ${holeCount}` }, { status: 400 });
    }

    const { error: updateErr } = await supabaseAdmin
      .from("rounds")
      .update({ starting_hole: holeNumber, starting_hole_source: "manual" })
      .eq("id", roundId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, round_id: roundId });
  } catch (e: any) {
    const msg = e?.message ?? "Server error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

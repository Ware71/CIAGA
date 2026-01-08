// /app/api/rounds/delete-draft/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = { round_id: string };

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json()) as Body;
    if (!body?.round_id) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });

    const myProfileId = await getOwnedProfileIdOrThrow(userData.user.id);

    // Confirm I'm the owner participant
    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me || me.role !== "owner") return NextResponse.json({ error: "Only round owner can delete" }, { status: 403 });

    // Confirm round is draft (and not live)
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });
    if (round.status !== "draft") {
      return NextResponse.json({ error: "Only draft rounds can be deleted" }, { status: 400 });
    }

    const roundId = body.round_id;

    // Collect any tee snapshot ids referenced anywhere (defensive)
    const teeIds = new Set<string>();

    const { data: partTees } = await supabaseAdmin
      .from("round_participants")
      .select("tee_snapshot_id")
      .eq("round_id", roundId);

    (partTees ?? []).forEach((r: any) => r?.tee_snapshot_id && teeIds.add(r.tee_snapshot_id));

    const { data: teeSnaps } = await supabaseAdmin
      .from("round_tee_snapshots")
      .select("id")
      .eq("round_id", roundId);

    (teeSnaps ?? []).forEach((r: any) => r?.id && teeIds.add(r.id));

    const teeIdArr = Array.from(teeIds);

    // Delete in safe order (works even if some tables are empty)
    // Scores/events
    await supabaseAdmin.from("round_score_events").delete().eq("round_id", roundId);
    await supabaseAdmin.from("round_current_scores").delete().eq("round_id", roundId);

    // Hole snapshots (if any tee snapshots exist)
    if (teeIdArr.length) {
      // chunk to avoid URL length issues
      const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
      for (const ids of chunk(teeIdArr, 100)) {
        await supabaseAdmin.from("round_hole_snapshots").delete().in("round_tee_snapshot_id", ids);
      }
    }

    // Tee snapshots + course snapshots
    await supabaseAdmin.from("round_tee_snapshots").delete().eq("round_id", roundId);
    await supabaseAdmin.from("round_course_snapshots").delete().eq("round_id", roundId);

    // Participants
    await supabaseAdmin.from("round_participants").delete().eq("round_id", roundId);

    // Finally the round
    const { error: delRoundErr } = await supabaseAdmin.from("rounds").delete().eq("id", roundId);
    if (delRoundErr) return NextResponse.json({ error: delRoundErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, round_id: roundId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

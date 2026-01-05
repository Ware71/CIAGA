// /app/api/rounds/start/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  round_id: string;
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const myProfileId = await getOwnedProfileIdOrThrow(user.id);
    const body = (await req.json()) as Body;

    if (!body?.round_id) {
      return NextResponse.json({ error: "Missing round_id" }, { status: 400 });
    }

    // Verify user is owner of this round (profile_id = profiles.id)
    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me || me.role !== "owner") {
      return NextResponse.json({ error: "Only round owner can start" }, { status: 403 });
    }

    // Load round + course + pending tee selection
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, course_id, pending_tee_box_id, status")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    if (round.status === "live") {
      return NextResponse.json({ ok: true, round_id: round.id });
    }

    if (!round.course_id) return NextResponse.json({ error: "Round has no course_id" }, { status: 400 });
    if (!round.pending_tee_box_id) return NextResponse.json({ error: "No tee selected for this round" }, { status: 400 });

    const teeBoxId = round.pending_tee_box_id as string;

    const { data: course, error: courseErr } = await supabaseAdmin
      .from("courses")
      .select("id, name, city, country, lat, lng")
      .eq("id", round.course_id)
      .single();

    if (courseErr) return NextResponse.json({ error: courseErr.message }, { status: 500 });

    // Create course snapshot
    const { data: rcs, error: rcsErr } = await supabaseAdmin
      .from("round_course_snapshots")
      .insert({
        round_id: round.id,
        source_course_id: course.id,
        course_name: course.name,
        city: course.city,
        country: course.country,
        lat: course.lat,
        lng: course.lng,
      })
      .select("id")
      .single();

    if (rcsErr) return NextResponse.json({ error: rcsErr.message }, { status: 500 });

    // Load tee box + holes
    const { data: tee, error: teeErr } = await supabaseAdmin
      .from("course_tee_boxes")
      .select("id, name, gender, yards, par, rating, slope, holes_count")
      .eq("id", teeBoxId)
      .single();

    if (teeErr) return NextResponse.json({ error: teeErr.message }, { status: 500 });

    const holesCount = tee.holes_count ?? 18;

    const { data: holes, error: holesErr } = await supabaseAdmin
      .from("course_tee_holes")
      .select("hole_number, par, yardage, handicap")
      .eq("tee_box_id", tee.id)
      .order("hole_number", { ascending: true });

    if (holesErr) return NextResponse.json({ error: holesErr.message }, { status: 500 });

    // Create tee snapshot
    const { data: rts, error: rtsErr } = await supabaseAdmin
      .from("round_tee_snapshots")
      .insert({
        round_course_snapshot_id: rcs.id,
        source_tee_box_id: tee.id,
        name: tee.name,
        gender: tee.gender,
        holes_count: holesCount,
        yards_total: tee.yards,
        par_total: tee.par,
        rating: tee.rating,
        slope: tee.slope,
      })
      .select("id")
      .single();

    if (rtsErr) return NextResponse.json({ error: rtsErr.message }, { status: 500 });

    // Create hole snapshots
    if (holes?.length) {
      const payload = holes
        .filter((h) => typeof h.hole_number === "number")
        .map((h) => ({
          round_tee_snapshot_id: rts.id,
          hole_number: h.hole_number,
          par: h.par,
          yardage: h.yardage,
          stroke_index: h.handicap,
        }));

      const { error: holeInsErr } = await supabaseAdmin.from("round_hole_snapshots").insert(payload);
      if (holeInsErr) return NextResponse.json({ error: holeInsErr.message }, { status: 500 });
    }

    // Assign tee snapshot to all participants (v1)
    const { error: assignErr } = await supabaseAdmin
      .from("round_participants")
      .update({ tee_snapshot_id: rts.id })
      .eq("round_id", round.id);

    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

    // Mark round live
    const { error: updErr } = await supabaseAdmin
      .from("rounds")
      .update({ status: "live", started_at: new Date().toISOString() })
      .eq("id", round.id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, round_id: round.id, tee_snapshot_id: rts.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

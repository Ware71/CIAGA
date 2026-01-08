// /app/api/rounds/start/route.ts
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

    const user = userData.user;
    const myProfileId = await getOwnedProfileIdOrThrow(user.id);

    const body = (await req.json()) as Body;
    if (!body?.round_id) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });

    // Verify caller is owner participant
    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me || me.role !== "owner") return NextResponse.json({ error: "Only round owner can start" }, { status: 403 });

    // Load round
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, course_id, pending_tee_box_id, status, started_at")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    // Already live -> idempotent OK
    if (round.status === "live") {
      return NextResponse.json({ ok: true, round_id: round.id });
    }

    if (!round.course_id) return NextResponse.json({ error: "Round has no course_id" }, { status: 400 });
    if (!round.pending_tee_box_id) return NextResponse.json({ error: "No tee selected for this round" }, { status: 400 });

    // -------------------------------
    // Atomic claim: only one starter wins
    // Requires you allow "starting" as a valid status.
    // -------------------------------
    const claimTs = new Date().toISOString();

    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("rounds")
      .update({ status: "starting", started_at: claimTs })
      .eq("id", round.id)
      .neq("status", "live")
      .neq("status", "starting")
      .select("id, status, started_at")
      .maybeSingle();

    if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });

    // If we didn't claim, someone else is starting/live already -> idempotent OK
    if (!claimed) {
      // We can return ok; client will refresh via realtime anyway
      return NextResponse.json({ ok: true, round_id: round.id });
    }

    const teeBoxId = round.pending_tee_box_id as string;

    // If snapshots already exist (e.g. previous run partially completed), reuse them
    const { data: existingTeeSnap } = await supabaseAdmin
      .from("round_tee_snapshots")
      .select("id, round_course_snapshot_id")
      .order("created_at", { ascending: false })
      .limit(1);

    // But existingTeeSnap isn't filtered by round in your schema. So we use round_course_snapshots as the anchor.
    // We'll check if a round_course_snapshot already exists for this round.
    const { data: existingCourseSnap, error: ecsErr } = await supabaseAdmin
      .from("round_course_snapshots")
      .select("id")
      .eq("round_id", round.id)
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (ecsErr) return NextResponse.json({ error: ecsErr.message }, { status: 500 });

    let courseSnapId: string;

    if (existingCourseSnap?.id) {
      courseSnapId = existingCourseSnap.id;
    } else {
      const { data: course, error: courseErr } = await supabaseAdmin
        .from("courses")
        .select("id, name, city, country, lat, lng")
        .eq("id", round.course_id)
        .single();

      if (courseErr) return NextResponse.json({ error: courseErr.message }, { status: 500 });

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
      courseSnapId = rcs.id;
    }

    // Check if we already have a tee snapshot for this round (by courseSnapId + source tee box)
    const { data: existingRts, error: exRtsErr } = await supabaseAdmin
      .from("round_tee_snapshots")
      .select("id")
      .eq("round_course_snapshot_id", courseSnapId)
      .eq("source_tee_box_id", teeBoxId)
      .maybeSingle();

    if (exRtsErr) return NextResponse.json({ error: exRtsErr.message }, { status: 500 });

    let teeSnapId: string;

    if (existingRts?.id) {
      teeSnapId = existingRts.id;
    } else {
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

      const { data: rts, error: rtsErr } = await supabaseAdmin
        .from("round_tee_snapshots")
        .insert({
          round_course_snapshot_id: courseSnapId,
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
      teeSnapId = rts.id;

      // Insert hole snapshots only if none exist for this teeSnap
      const { data: existingHoles, error: exHolesErr } = await supabaseAdmin
        .from("round_hole_snapshots")
        .select("hole_number")
        .eq("round_tee_snapshot_id", teeSnapId)
        .limit(1);

      if (exHolesErr) return NextResponse.json({ error: exHolesErr.message }, { status: 500 });

      if ((existingHoles?.length ?? 0) === 0 && holes?.length) {
        const payload = holes
          .filter((h) => typeof h.hole_number === "number")
          .map((h) => ({
            round_tee_snapshot_id: teeSnapId,
            hole_number: h.hole_number,
            par: h.par,
            yardage: h.yardage,
            stroke_index: h.handicap,
          }));

        const { error: holeInsErr } = await supabaseAdmin.from("round_hole_snapshots").insert(payload);
        if (holeInsErr) return NextResponse.json({ error: holeInsErr.message }, { status: 500 });
      }
    }

    // Assign tee snapshot to all participants (idempotent)
    const { error: assignErr } = await supabaseAdmin
      .from("round_participants")
      .update({ tee_snapshot_id: teeSnapId })
      .eq("round_id", round.id);

    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

    // Finalize: mark live (idempotent)
    const { error: updErr } = await supabaseAdmin
      .from("rounds")
      .update({ status: "live" })
      .eq("id", round.id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, round_id: round.id, tee_snapshot_id: teeSnapId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

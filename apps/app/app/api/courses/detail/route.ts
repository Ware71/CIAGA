import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const course_id = (new URL(req.url).searchParams.get("course_id") ?? "").trim();
  if (!course_id) return NextResponse.json({ error: "Missing course_id" }, { status: 400 });

  const course = await supabaseAdmin.from("courses").select("*").eq("id", course_id).single();
  if (course.error) return NextResponse.json({ error: course.error.message }, { status: 404 });

  // Tee boxes sorted by highest rating first (then slope, then yards).
  // This matches what you want in UI even if sort_order exists.
  const tees = await supabaseAdmin
    .from("course_tee_boxes")
    .select("*")
    .eq("course_id", course_id)
    .order("rating", { ascending: false, nullsFirst: false })
    .order("slope", { ascending: false, nullsFirst: false })
    .order("yards", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true });

  if (tees.error) {
    return NextResponse.json({ error: tees.error.message }, { status: 500 });
  }

  const teeBoxes = tees.data ?? [];
  if (!teeBoxes.length) {
    return NextResponse.json({ course: course.data, tee_boxes: [] });
  }

  const teeIds = teeBoxes.map((t) => t.id);

  const holes = await supabaseAdmin
    .from("course_tee_holes")
    .select("*")
    .in("tee_box_id", teeIds)
    .order("hole_number", { ascending: true });

  if (holes.error) {
    return NextResponse.json({ error: holes.error.message }, { status: 500 });
  }

  // Group holes by tee_box_id
  const holesByTee: Record<string, any[]> = {};
  for (const h of holes.data ?? []) {
    (holesByTee[h.tee_box_id] ||= []).push(h);
  }

  const tee_boxes = teeBoxes.map((t) => ({
    ...t,
    holes: holesByTee[t.id] ?? [],
  }));

  return NextResponse.json({
    course: course.data,
    tee_boxes,
  });
}

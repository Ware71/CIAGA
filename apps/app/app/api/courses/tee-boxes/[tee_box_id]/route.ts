import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ tee_box_id: string }> } // <- params can be a Promise
) {
  const { tee_box_id: rawId } = await ctx.params; // <- unwrap
  const tee_box_id = (rawId ?? "").trim();

  const { searchParams } = new URL(req.url);
  const course_id = (searchParams.get("course_id") ?? "").trim();

  if (!tee_box_id) {
    return NextResponse.json({ error: "Missing tee_box_id" }, { status: 400 });
  }
  if (!course_id) {
    return NextResponse.json({ error: "Missing course_id" }, { status: 400 });
  }

  // Ensure tee box exists and belongs to this course
  const tee = await supabaseAdmin
    .from("course_tee_boxes")
    .select("id, course_id")
    .eq("id", tee_box_id)
    .maybeSingle();

  if (tee.error) {
    return NextResponse.json({ error: tee.error.message }, { status: 500 });
  }
  if (!tee.data) {
    return NextResponse.json({ error: "Tee box not found" }, { status: 404 });
  }
  if (tee.data.course_id !== course_id) {
    return NextResponse.json({ error: "Tee box does not belong to course" }, { status: 403 });
  }

  // Delete holes first (safe even if FK cascade exists)
  const delHoles = await supabaseAdmin
    .from("course_tee_holes")
    .delete()
    .eq("tee_box_id", tee_box_id);

  if (delHoles.error) {
    return NextResponse.json({ error: delHoles.error.message }, { status: 500 });
  }

  // Delete tee box
  const delTee = await supabaseAdmin
    .from("course_tee_boxes")
    .delete()
    .eq("id", tee_box_id)
    .eq("course_id", course_id);

  if (delTee.error) {
    return NextResponse.json({ error: delTee.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

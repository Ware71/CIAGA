import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type EditHole = {
  id?: string | null;
  hole_number: number;
  par?: number | null;
  yardage?: number | null;
  handicap?: number | null;
};

type EditTeeBox = {
  id: string; // existing tee box id (uuid)
  name?: string;
  gender?: string | null;
  yards?: number | null;
  par?: number | null;
  rating?: number | null;
  slope?: number | null;
  holes?: EditHole[];
};

type Body = {
  course_id: string;
  course_name?: string;
  tee_boxes?: EditTeeBox[];
};

function normalizeGender(g: any): "male" | "female" | "unisex" | null {
  if (g === null || g === undefined || g === "") return null;
  const s = String(g).toLowerCase().trim();
  if (["male", "men", "m"].includes(s)) return "male";
  if (["female", "women", "w", "f", "ladies", "lady"].includes(s)) return "female";
  return "unisex";
}

function toNullableNumber(v: any): number | null {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanString(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const course_id = (body.course_id ?? "").trim();
  if (!course_id) return NextResponse.json({ error: "Missing course_id" }, { status: 400 });

  // Ensure course exists
  const course = await supabaseAdmin.from("courses").select("id").eq("id", course_id).maybeSingle();
  if (course.error) return NextResponse.json({ error: course.error.message }, { status: 500 });
  if (!course.data) return NextResponse.json({ error: "Course not found" }, { status: 404 });

  // Update course name if provided
  const course_name = cleanString(body.course_name);
  if (course_name) {
    const updCourse = await supabaseAdmin
      .from("courses")
      .update({ name: course_name })
      .eq("id", course_id);

    if (updCourse.error) return NextResponse.json({ error: updCourse.error.message }, { status: 500 });
  }

  const tee_boxes = Array.isArray(body.tee_boxes) ? body.tee_boxes : [];

  for (const tee of tee_boxes) {
    const tee_id = (tee.id ?? "").trim();
    if (!tee_id) continue;

    // Update tee box fields
    const teeUpdate: Record<string, any> = {};
    const teeName = cleanString(tee.name);
    if (teeName) teeUpdate.name = teeName;

    if ("gender" in tee) teeUpdate.gender = normalizeGender(tee.gender);
    if ("yards" in tee) teeUpdate.yards = toNullableNumber(tee.yards);
    if ("par" in tee) teeUpdate.par = toNullableNumber(tee.par);
    if ("rating" in tee) teeUpdate.rating = toNullableNumber(tee.rating);
    if ("slope" in tee) teeUpdate.slope = toNullableNumber(tee.slope);

    // Only hit DB if something changed
    if (Object.keys(teeUpdate).length > 0) {
      const updTee = await supabaseAdmin
        .from("course_tee_boxes")
        .update(teeUpdate)
        .eq("id", tee_id)
        .eq("course_id", course_id);

      if (updTee.error) {
        return NextResponse.json({ error: updTee.error.message, tee_id }, { status: 500 });
      }
    }

    // Holes: update existing + insert new rows (no deletes)
    const holes = Array.isArray(tee.holes) ? tee.holes : [];
    for (const h of holes) {
      const hole_number = Number(h.hole_number);
      if (!Number.isFinite(hole_number) || hole_number <= 0) continue;

      const holePayload = {
        tee_box_id: tee_id,
        hole_number,
        par: toNullableNumber(h.par),
        yardage: toNullableNumber(h.yardage),
        handicap: toNullableNumber(h.handicap),
      };

      const hasAnyValue =
        holePayload.par !== null || holePayload.yardage !== null || holePayload.handicap !== null;

      // If nothing filled in, skip inserting/updating
      if (!hasAnyValue) continue;

      const hole_id = (h.id ?? "").trim();

      if (hole_id) {
        const updHole = await supabaseAdmin
          .from("course_tee_holes")
          .update({
            par: holePayload.par,
            yardage: holePayload.yardage,
            handicap: holePayload.handicap,
            hole_number: holePayload.hole_number,
          })
          .eq("id", hole_id)
          .eq("tee_box_id", tee_id);

        if (updHole.error) {
          return NextResponse.json({ error: updHole.error.message, hole_id }, { status: 500 });
        }
      } else {
        // If hole doesn't exist, insert.
        // Avoid duplicates by checking if same tee_box_id + hole_number exists.
        const existing = await supabaseAdmin
          .from("course_tee_holes")
          .select("id")
          .eq("tee_box_id", tee_id)
          .eq("hole_number", hole_number)
          .maybeSingle();

        if (existing.error) {
          return NextResponse.json({ error: existing.error.message }, { status: 500 });
        }

        if (existing.data?.id) {
          const updExisting = await supabaseAdmin
            .from("course_tee_holes")
            .update({
              par: holePayload.par,
              yardage: holePayload.yardage,
              handicap: holePayload.handicap,
            })
            .eq("id", existing.data.id);

          if (updExisting.error) {
            return NextResponse.json({ error: updExisting.error.message }, { status: 500 });
          }
        } else {
          const ins = await supabaseAdmin.from("course_tee_holes").insert(holePayload);
          if (ins.error) {
            return NextResponse.json({ error: ins.error.message }, { status: 500 });
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

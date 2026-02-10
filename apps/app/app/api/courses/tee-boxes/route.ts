import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type CreateTeeBoxBody = {
  course_id: string;
  name: string;
  gender?: string | null; // "male" | "female" | "unisex" | null
  yards?: number | null;
  par?: number | null;
  rating?: number | null;
  slope?: number | null;
};

function toNullableNumber(v: any): number | null {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeGender(g: any): "male" | "female" | "unisex" {
  const s = String(g ?? "")
    .toLowerCase()
    .trim();
  if (["male", "men", "m"].includes(s)) return "male";
  if (["female", "women", "w", "f", "ladies", "lady"].includes(s)) return "female";
  return "unisex";
}

export async function POST(req: NextRequest) {
  let body: CreateTeeBoxBody | null = null;

  try {
    body = (await req.json()) as CreateTeeBoxBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const course_id = (body?.course_id ?? "").trim();
  const name = (body?.name ?? "").trim();

  if (!course_id) return NextResponse.json({ error: "Missing course_id" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  // Ensure course exists (avoid orphan tee boxes)
  const course = await supabaseAdmin.from("courses").select("id").eq("id", course_id).maybeSingle();
  if (course.error) return NextResponse.json({ error: course.error.message }, { status: 500 });
  if (!course.data) return NextResponse.json({ error: "Course not found" }, { status: 404 });

  // Append sort_order (max + 1)
  const maxSort = await supabaseAdmin
    .from("course_tee_boxes")
    .select("sort_order")
    .eq("course_id", course_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (maxSort.error) return NextResponse.json({ error: maxSort.error.message }, { status: 500 });

  const currentMax = (maxSort.data?.[0]?.sort_order ?? -1) as number;
  const sort_order = Number.isFinite(currentMax) ? currentMax + 1 : 0;

  const insertRes = await supabaseAdmin
    .from("course_tee_boxes")
    .insert({
      course_id,
      name,
      gender: body?.gender === null ? null : normalizeGender(body?.gender),
      yards: toNullableNumber(body?.yards),
      par: toNullableNumber(body?.par),
      rating: toNullableNumber(body?.rating),
      slope: toNullableNumber(body?.slope),
      sort_order,
    })
    .select("*")
    .single();

  if (insertRes.error) {
    return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ tee_box: insertRes.data });
}

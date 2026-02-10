import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const { osm_ids } = (await req.json()) as { osm_ids: string[] };

  if (!Array.isArray(osm_ids) || osm_ids.length === 0) {
    return NextResponse.json({ map: {} });
  }

  const { data, error } = await supabaseAdmin
    .from("courses")
    .select("id, osm_id, name")
    .in("osm_id", osm_ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const map: Record<string, { course_id: string; name: string }> = {};
  for (const row of data ?? []) {
    map[row.osm_id] = { course_id: row.id, name: row.name };
  }

  return NextResponse.json({ map });
}

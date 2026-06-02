import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

async function assertAdminOrOwner(eventId: string, profileId: string) {
  const event = await getEventById(eventId);
  if (!event) return null;
  if (!event.group_id) return null;
  const { data: m } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", event.group_id)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (!m || !["owner", "admin"].includes((m as any).role)) return null;
  return event;
}

// GET /api/majors/events/[id]/charges
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data, error } = await supabaseAdmin
      .from("event_charges")
      .select("*")
      .eq("event_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ charges: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

// POST /api/majors/events/[id]/charges
// Body: { name, amount, category?, description?, applies_to_all_entries? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await assertAdminOrOwner(id, profileId);
    if (!event) return NextResponse.json({ error: "Not authorised or event not found." }, { status: 403 });

    const body = await req.json();
    const { name, amount, category = "other", description, applies_to_all_entries = false, round_id } = body as {
      name: string;
      amount: number;
      category?: string;
      description?: string;
      applies_to_all_entries?: boolean;
      round_id?: string | null;
    };

    if (!name || amount == null) {
      return NextResponse.json({ error: "name and amount are required." }, { status: 400 });
    }

    const validCategories = ["green_fee", "buggy", "food", "drink", "other"];
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: "Invalid category." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("event_charges")
      .insert({ event_id: id, name, amount, category, description: description ?? null, applies_to_all_entries, round_id: round_id ?? null, created_by: profileId })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ charge: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

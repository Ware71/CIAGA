import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

async function assertMember(groupId: string, profileId: string) {
  const { data } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  return data ? (data as any).role as string : null;
}

// GET /api/majors/groups/[id]/group-charges
// All active members can view; returns is_active=true only for non-admins.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    const role = await assertMember(groupId, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member." }, { status: 403 });

    let query = supabaseAdmin
      .from("group_charges")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });

    // Non-admins only see active charges
    if (!["owner", "admin"].includes(role)) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ charges: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: msg.includes("auth") ? 401 : 500 });
  }
}

// POST /api/majors/groups/[id]/group-charges
// Body: { name, amount, category?, description?, is_mandatory?, is_active? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    const role = await assertMember(groupId, profileId);
    if (!role || !["owner", "admin"].includes(role)) {
      return NextResponse.json({ error: "Only group owner or admin can create group charges." }, { status: 403 });
    }

    const body = await req.json();
    const {
      name,
      amount,
      category = "other",
      description,
      is_mandatory = true,
      is_active = true,
    } = body as {
      name: string;
      amount: number;
      category?: string;
      description?: string;
      is_mandatory?: boolean;
      is_active?: boolean;
    };

    if (!name?.trim()) return NextResponse.json({ error: "name is required." }, { status: 400 });
    if (!amount || amount <= 0) return NextResponse.json({ error: "amount must be positive." }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from("group_charges")
      .insert({
        group_id: groupId,
        name: name.trim(),
        amount,
        category,
        description: description ?? null,
        is_mandatory,
        is_active,
        created_by: profileId,
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ charge: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: msg.includes("auth") ? 401 : 500 });
  }
}

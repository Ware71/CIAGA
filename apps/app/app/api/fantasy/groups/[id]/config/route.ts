import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { parseFantasyConfigInput, readFantasyConfig } from "@/lib/fantasy/config";
import { getGroupFantasyContext, getGroupRole } from "@/lib/fantasy/wallet";

export const runtime = "nodejs";

// GET /api/fantasy/groups/[id]/config — current fantasy config (members only)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const role = await getGroupRole(id, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const ctx = await getGroupFantasyContext(id);
    if (!ctx) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    return NextResponse.json(
      { config: readFantasyConfig(ctx.fantasyConfig) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// PUT /api/fantasy/groups/[id]/config — enable/update/disable (owner/admin only)
// Body: { disabled: true }  → disable fantasy picks
//       { mode, budgetScope, budgetAmount, topupIncrement? } → enable/update
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const role = await getGroupRole(id, profileId);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json(
        { error: "Only group owner or admin can configure fantasy picks" },
        { status: 403 }
      );
    }

    const body = await req.json();

    let config: ReturnType<typeof readFantasyConfig> = null;
    if (!body?.disabled) {
      const parsed = parseFantasyConfigInput(body, profileId);
      if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      config = parsed.config;
    }

    const { error } = await supabaseAdmin
      .from("major_groups")
      .update({ fantasy_config: config, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ config });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

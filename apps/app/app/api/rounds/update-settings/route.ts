// /app/api/rounds/update-settings/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body = {
  round_id: string;
  format_type?: string;
  format_config?: Record<string, any>;
  side_games?: Array<any>;
  default_playing_handicap_mode?: "none" | "allowance_pct" | "fixed";
  default_playing_handicap_value?: number;
  scheduled_at?: string | null;
  name?: string;
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const myProfileId = await getOwnedProfileIdOrThrow(userData.user.id);
    const body = (await req.json()) as Body;

    if (!body?.round_id) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });

    // Load round and verify participant
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status, created_by")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    // Check if user is participant
    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me) return NextResponse.json({ error: "Not a participant in this round" }, { status: 403 });

    const isOwner = me.role === "owner";
    const isEditable = round.status === "draft" || round.status === "scheduled";

    if (!isEditable) {
      return NextResponse.json({ error: "Round settings can only be edited while draft or scheduled" }, { status: 400 });
    }

    // Build update object based on permissions
    const updates: any = {};

    // Format config and side games can be edited by any participant (while draft/scheduled)
    if (body.format_config !== undefined) updates.format_config = body.format_config;
    if (body.side_games !== undefined) updates.side_games = body.side_games;

    // Format type, visibility, and handicap defaults require owner permission
    if (isOwner) {
      if (body.format_type !== undefined) updates.format_type = body.format_type;
      if (body.default_playing_handicap_mode !== undefined) {
        updates.default_playing_handicap_mode = body.default_playing_handicap_mode;
      }
      if (body.default_playing_handicap_value !== undefined) {
        updates.default_playing_handicap_value = body.default_playing_handicap_value;
      }
      if (body.scheduled_at !== undefined) {
        updates.scheduled_at = body.scheduled_at;
        // Update status if scheduling/unscheduling
        if (body.scheduled_at && round.status === "draft") {
          updates.status = "scheduled";
        } else if (!body.scheduled_at && round.status === "scheduled") {
          updates.status = "draft";
        }
      }
    }

    // Name can be edited by any participant (while draft/scheduled)
    if (body.name !== undefined) updates.name = body.name;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: true, round_id: body.round_id });
    }

    // Apply updates
    const { error: updateErr } = await supabaseAdmin
      .from("rounds")
      .update(updates)
      .eq("id", body.round_id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, round_id: body.round_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

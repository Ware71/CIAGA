// /app/api/rounds/manage-teams/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";

type Body =
  | { round_id: string; action: "create_team"; name: string }
  | { round_id: string; action: "delete_team"; team_id: string }
  | { round_id: string; action: "assign_player"; participant_id: string; team_id: string | null }
  | { round_id: string; action: "rename_team"; team_id: string; name: string };

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
    if (!body?.action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

    // Load round and verify ownership
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status")
      .eq("id", body.round_id)
      .single();

    if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 });

    const { data: me, error: meErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
    if (!me || me.role !== "owner") return NextResponse.json({ error: "Only the round owner can manage teams" }, { status: 403 });

    const isEditable = (round as any).status === "draft" || (round as any).status === "scheduled";
    if (!isEditable) return NextResponse.json({ error: "Teams can only be edited while draft or scheduled" }, { status: 400 });

    if (body.action === "create_team") {
      if (!body.name?.trim()) return NextResponse.json({ error: "Team name required" }, { status: 400 });

      // Get next team_number
      const { data: existing, error: existErr } = await supabaseAdmin
        .from("round_teams")
        .select("team_number")
        .eq("round_id", body.round_id)
        .order("team_number", { ascending: false })
        .limit(1);

      if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });
      const nextNumber = ((existing?.[0] as any)?.team_number ?? 0) + 1;

      const { data: team, error: insertErr } = await supabaseAdmin
        .from("round_teams")
        .insert({ round_id: body.round_id, name: body.name.trim(), team_number: nextNumber })
        .select()
        .single();

      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
      return NextResponse.json({ team });
    }

    if (body.action === "delete_team") {
      if (!body.team_id) return NextResponse.json({ error: "Missing team_id" }, { status: 400 });

      const { error: delErr } = await supabaseAdmin
        .from("round_teams")
        .delete()
        .eq("id", body.team_id)
        .eq("round_id", body.round_id);

      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "assign_player") {
      if (!body.participant_id) return NextResponse.json({ error: "Missing participant_id" }, { status: 400 });

      // If team_id provided, verify it belongs to this round
      if (body.team_id) {
        const { data: team, error: teamErr } = await supabaseAdmin
          .from("round_teams")
          .select("id")
          .eq("id", body.team_id)
          .eq("round_id", body.round_id)
          .maybeSingle();

        if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });
        if (!team) return NextResponse.json({ error: "Team not found in this round" }, { status: 404 });
      }

      const { error: updateErr } = await supabaseAdmin
        .from("round_participants")
        .update({ team_id: body.team_id ?? null })
        .eq("id", body.participant_id)
        .eq("round_id", body.round_id);

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "rename_team") {
      if (!body.team_id) return NextResponse.json({ error: "Missing team_id" }, { status: 400 });
      const trimmed = body.name?.trim();
      if (!trimmed) return NextResponse.json({ error: "Team name required" }, { status: 400 });

      const { error: updateErr } = await supabaseAdmin
        .from("round_teams")
        .update({ name: trimmed })
        .eq("id", body.team_id)
        .eq("round_id", body.round_id);

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

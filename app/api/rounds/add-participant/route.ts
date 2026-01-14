// app/api/rounds/add-participant/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Body =
  | { round_id: string; kind: "profile"; profile_id: string; role?: "owner" | "scorer" | "player" }
  | { round_id: string; kind: "guest"; display_name: string; role?: "owner" | "scorer" | "player" };

async function getMyProfileIdFromAuthUserId(authUserId: string) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("owner_user_id", authUserId)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function POST(req: Request) {
  try {
    // --- Auth ---
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authUser = userData.user;

    const body = (await req.json()) as Body;
    if (!body.round_id) {
      return NextResponse.json({ error: "Missing round_id" }, { status: 400 });
    }

    // --- Resolve my canonical profile id (Model B) ---
    const myProfileId = await getMyProfileIdFromAuthUserId(authUser.id);
    if (!myProfileId) {
      return NextResponse.json({ error: "Profile not found for user" }, { status: 400 });
    }

    // --- Owner check ---
    const { data: ownerRow, error: ownerErr } = await supabaseAdmin
      .from("round_participants")
      .select("role")
      .eq("round_id", body.round_id)
      .eq("profile_id", myProfileId)
      .maybeSingle();

    if (ownerErr) {
      return NextResponse.json({ error: ownerErr.message }, { status: 500 });
    }

    if (!ownerRow || ownerRow.role !== "owner") {
      return NextResponse.json({ error: "Only owner can add participants" }, { status: 403 });
    }

    const role = "role" in body && body.role ? body.role : "player";

    // --- Add profile participant ---
    if (body.kind === "profile") {
      // Optional duplicate protection (uncomment if you want it):
      // const { data: existing } = await supabaseAdmin
      //   .from("round_participants")
      //   .select("id")
      //   .eq("round_id", body.round_id)
      //   .eq("profile_id", body.profile_id)
      //   .maybeSingle();
      // if (existing?.id) return NextResponse.json({ ok: true, existed: true });

      const { error: insErr } = await supabaseAdmin.from("round_participants").insert({
        round_id: body.round_id,
        profile_id: body.profile_id, // ✅ profiles.id ONLY
        role,
        is_guest: false,
      });

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

      return NextResponse.json({ ok: true });
    }

    // --- Add guest participant ---
    if (body.kind === "guest") {
      const name = body.display_name?.trim();
      if (!name) {
        return NextResponse.json({ error: "Guest name required" }, { status: 400 });
      }

      // Optional duplicate protection (uncomment if you want it):
      // const { data: existing } = await supabaseAdmin
      //   .from("round_participants")
      //   .select("id")
      //   .eq("round_id", body.round_id)
      //   .eq("is_guest", true)
      //   .ilike("display_name", name)
      //   .maybeSingle();
      // if (existing?.id) return NextResponse.json({ ok: true, existed: true });

      const { error: insErr } = await supabaseAdmin.from("round_participants").insert({
        round_id: body.round_id,
        profile_id: null,
        is_guest: true,
        display_name: name,
        role,
      });

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

// app/api/rounds/add-participant/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createManagedProfile } from "@/lib/server/managedProfiles";
import { notifyRoundSchedule } from "@/lib/notifications/roundSchedule";

type Body =
  | { round_id: string; kind: "profile"; profile_id: string; role?: "owner" | "scorer" | "player" }
  | {
      round_id: string;
      kind: "guest";
      display_name: string;
      email?: string;
      send_invite?: boolean;
      role?: "owner" | "scorer" | "player";
    };

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

    // Round context — used to notify the added player when the round is scheduled.
    const { data: roundInfo } = await supabaseAdmin
      .from("rounds")
      .select("status, scheduled_at, courses(name)")
      .eq("id", body.round_id)
      .maybeSingle();
    const isScheduled = (roundInfo as any)?.status === "scheduled";
    const notifyAddedPlayer = async (addedProfileId: string | null | undefined) => {
      if (!isScheduled || !addedProfileId) return;
      await notifyRoundSchedule({
        roundId: body.round_id,
        actorProfileId: myProfileId,
        type: "round_scheduled",
        recipientProfileIds: [addedProfileId],
        courseName: (roundInfo as any)?.courses?.name ?? null,
        scheduledAt: (roundInfo as any)?.scheduled_at ?? null,
      });
    };

    // --- Player limit (max 4) ---
    const { count, error: countErr } = await supabaseAdmin
      .from("round_participants")
      .select("id", { count: "exact", head: true })
      .eq("round_id", body.round_id);

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }
    if ((count ?? 0) >= 4) {
      return NextResponse.json({ error: "Maximum 4 players per round" }, { status: 400 });
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

      await notifyAddedPlayer(body.profile_id);

      return NextResponse.json({ ok: true });
    }

    // --- Add a non-registered player ---
    // Instead of a guest placeholder, create a real (unclaimed) profile attributed to the
    // adder, mutually following them, then attach it to the round as a normal participant.
    if (body.kind === "guest") {
      const name = body.display_name?.trim();
      if (!name) {
        return NextResponse.json({ error: "Player name required" }, { status: 400 });
      }

      const email = typeof body.email === "string" ? body.email.trim() : "";
      const sendInvite = !!email && body.send_invite !== false;

      let created;
      try {
        created = await createManagedProfile({
          name,
          email: email || null,
          creatorProfileId: myProfileId,
          sendInvite,
          siteOrigin: new URL(req.url).origin,
        });
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || "Failed to create player profile" },
          { status: 500 }
        );
      }

      const { error: insErr } = await supabaseAdmin.from("round_participants").insert({
        round_id: body.round_id,
        profile_id: created.profileId,
        is_guest: false,
        role,
      });

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

      await notifyAddedPlayer(created.profileId);

      return NextResponse.json({
        ok: true,
        profile_id: created.profileId,
        invited: created.invited,
      });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

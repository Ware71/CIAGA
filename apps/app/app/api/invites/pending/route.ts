import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveClaimableProfile } from "@/lib/server/managedProfiles";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const email = (user.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ pending: false, profile_id: null });

    // Resolve a claimable profile: newest active invite for this email, else newest unclaimed
    // profile whose email matches (covers signing up directly with an invited email).
    const claimable = await resolveClaimableProfile(email);
    if (!claimable) {
      return NextResponse.json({ pending: false, profile_id: null });
    }

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, owner_user_id, name, email, created_at, created_by")
      .eq("id", claimable.profileId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    // If profile already claimed, auto-revoke the active invite (if any) to stop future loops.
    if (!prof || prof.owner_user_id) {
      if (claimable.inviteId) {
        await supabaseAdmin
          .from("invites")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", claimable.inviteId);
      }
      return NextResponse.json({ pending: false, profile_id: null });
    }

    let createdByName: string | null = null;
    if (prof.created_by) {
      const { data: creator } = await supabaseAdmin
        .from("profiles")
        .select("name")
        .eq("id", prof.created_by)
        .maybeSingle();
      createdByName = creator?.name ?? null;
    }

    return NextResponse.json({
      pending: true,
      profile_id: prof.id,
      profile_preview: {
        name: prof.name ?? null,
        email: prof.email ?? null,
        created_at: prof.created_at ?? null,
        created_by_name: createdByName,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

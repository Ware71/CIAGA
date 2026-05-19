import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "sandbox") {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { profileId } = await req.json();
    if (!profileId) return NextResponse.json({ error: "profileId required" }, { status: 400 });

    const { data: profileRow, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, owner_user_id, email")
      .eq("id", profileId)
      .single();

    if (profileErr || !profileRow) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

    let targetEmail: string;

    if (profileRow.owner_user_id) {
      // Owned profile — fetch the auth user's email
      const { data: authUserData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(
        profileRow.owner_user_id
      );
      if (authErr || !authUserData?.user?.email) {
        return NextResponse.json({ error: "Could not resolve auth user email" }, { status: 500 });
      }
      targetEmail = authUserData.user.email;
    } else {
      // Unowned profile — create or reuse a sandbox throwaway auth user
      const sandboxEmail = `sandbox+${profileId}@ciagasandbox.dev`;

      // Check if a sandbox user already exists for this email
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const existing = listData?.users?.find((u) => u.email === sandboxEmail);

      if (existing) {
        targetEmail = sandboxEmail;
        // Ensure the profile is linked (in case a previous attempt failed mid-way)
        if (!profileRow.owner_user_id) {
          await supabaseAdmin
            .from("profiles")
            .update({ owner_user_id: existing.id })
            .eq("id", profileId);
        }
      } else {
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: sandboxEmail,
          email_confirm: true,
        });
        if (createErr || !newUser?.user) {
          return NextResponse.json(
            { error: createErr?.message || "Failed to create sandbox user" },
            { status: 500 }
          );
        }
        targetEmail = sandboxEmail;
        await supabaseAdmin
          .from("profiles")
          .update({ owner_user_id: newUser.user.id })
          .eq("id", profileId);
      }
    }

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
      options: { redirectTo: origin },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      return NextResponse.json(
        { error: linkErr?.message || "Failed to generate sign-in link" },
        { status: 500 }
      );
    }

    return NextResponse.json({ actionLink: linkData.properties.action_link });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

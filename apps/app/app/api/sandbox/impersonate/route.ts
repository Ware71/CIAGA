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

      let sandboxUserId: string;

      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: sandboxEmail,
        email_confirm: true,
      });

      if (newUser?.user) {
        sandboxUserId = newUser.user.id;
      } else if (
        createErr &&
        (createErr.message?.toLowerCase().includes("already") || (createErr as any).status === 422)
      ) {
        // Sandbox user exists but may be beyond the first listUsers page — paginate to find them
        let found: { id: string } | null = null;
        let page = 1;
        while (!found) {
          const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
          const match = listData?.users?.find((u) => u.email === sandboxEmail);
          if (match) { found = match; break; }
          if (!listData?.users?.length || listData.users.length < 1000) break;
          page++;
        }
        if (!found) {
          return NextResponse.json({ error: "Could not locate existing sandbox user" }, { status: 500 });
        }
        sandboxUserId = found.id;
      } else {
        return NextResponse.json(
          { error: createErr?.message || "Failed to create sandbox user" },
          { status: 500 }
        );
      }

      targetEmail = sandboxEmail;
      await supabaseAdmin
        .from("profiles")
        .update({ owner_user_id: sandboxUserId })
        .eq("id", profileId);
    }

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      return NextResponse.json(
        { error: linkErr?.message || "Failed to generate sign-in link" },
        { status: 500 }
      );
    }

    return NextResponse.json({ tokenHash: linkData.properties.hashed_token });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

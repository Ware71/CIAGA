import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

/** True if `profileId` may manage this event (group owner/admin, or the creator
 *  of a non-group event). Mirrors the tee-times route + client isAdminOrOwner. */
async function isEventAdmin(event: any, profileId: string): Promise<boolean> {
  if (event.group_id) {
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();
    return !!membership && ["owner", "admin"].includes((membership as any).role);
  }
  return event.created_by_profile_id === profileId;
}

// POST /api/majors/events/[id]/invitations — invite a player to an event.
// Body: { profile_id }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (!(await isEventAdmin(event, profileId))) {
      return NextResponse.json({ error: "Only the event owner or admin can invite players" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    if (!body.profile_id) {
      return NextResponse.json({ error: "profile_id required" }, { status: 400 });
    }

    // Don't invite players who are already entered.
    const { data: entry } = await supabaseAdmin
      .from("event_entries")
      .select("id")
      .eq("event_id", id)
      .eq("profile_id", body.profile_id)
      .maybeSingle();
    if (entry) {
      return NextResponse.json({ error: "Player is already entered" }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from("event_invitations")
      .upsert(
        {
          event_id: id,
          profile_id: body.profile_id,
          status: "invited",
          invited_by: profileId,
        },
        { onConflict: "event_id,profile_id", ignoreDuplicates: false }
      )
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ invitation: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/majors/events/[id]/invitations?profile_id=X
// Invitee declines their own invite, or an event admin rescinds it.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const url = new URL(req.url);
    const targetProfileId = url.searchParams.get("profile_id") ?? profileId;

    if (targetProfileId !== profileId) {
      const event = await getEventById(id);
      if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
      if (!(await isEventAdmin(event, profileId))) {
        return NextResponse.json({ error: "Not allowed to remove this invite" }, { status: 403 });
      }
    }

    const { error } = await supabaseAdmin
      .from("event_invitations")
      .delete()
      .eq("event_id", id)
      .eq("profile_id", targetProfileId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/events/[id]/join-preview
// Returns all charges, prize pots, and balance info the player needs to see before joining.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (!event.group_id) {
      return NextResponse.json({ error: "Event has no associated group" }, { status: 400 });
    }

    // Must be an active group member
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("status")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!membership || (membership as any).status !== "active") {
      return NextResponse.json({ error: "You must be a group member to preview this event" }, { status: 403 });
    }

    // ── 1. Event charges ──────────────────────────────────────────────────────
    const { data: allCharges } = await supabaseAdmin
      .from("event_charges")
      .select("*")
      .eq("event_id", id)
      .order("created_at", { ascending: true });

    const charges = allCharges ?? [];
    const mandatory_charges = charges.filter((c: any) => c.is_mandatory);
    const optional_charges = charges.filter((c: any) => !c.is_mandatory);

    // ── 2. Event prize pots (filter out already-enrolled) ────────────────────
    const { data: eventPots } = await supabaseAdmin
      .from("prize_pots")
      .select("*")
      .eq("event_id", id)
      .in("status", ["active", "locked"])
      .order("created_at", { ascending: true });

    const { data: enrolledEntries } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("prize_pot_id")
      .eq("profile_id", profileId)
      .in("prize_pot_id", (eventPots ?? []).map((p: any) => p.id));

    const enrolledPotIds = new Set((enrolledEntries ?? []).map((e: any) => e.prize_pot_id));
    const unenrolledEventPots = (eventPots ?? []).filter((p: any) => !enrolledPotIds.has(p.id));
    const mandatory_prize_pots = unenrolledEventPots.filter((p: any) => p.is_mandatory);
    const optional_prize_pots = unenrolledEventPots.filter((p: any) => !p.is_mandatory);

    // ── 3. Season prize pots ──────────────────────────────────────────────────
    const seasonPotFilters: any[] = [];
    if ((event as any).season_id) {
      seasonPotFilters.push({ competition_season_id: (event as any).season_id });
    }
    if ((event as any).group_season_id) {
      seasonPotFilters.push({ group_season_id: (event as any).group_season_id });
    }

    let season_mandatory_pots: any[] = [];
    let season_optional_pots: any[] = [];

    if (seasonPotFilters.length > 0) {
      let seasonPotsQuery = supabaseAdmin
        .from("prize_pots")
        .select("*")
        .eq("group_id", event.group_id)
        .in("status", ["active", "locked"]);

      // Build OR filter for season scopes
      const orParts = seasonPotFilters
        .map((f) => {
          const [key, val] = Object.entries(f)[0] as [string, string];
          return `${key}.eq.${val}`;
        })
        .join(",");
      seasonPotsQuery = seasonPotsQuery.or(orParts);

      const { data: seasonPots } = await seasonPotsQuery;

      if (seasonPots && seasonPots.length > 0) {
        const seasonPotIds = seasonPots.map((p: any) => p.id);
        const { data: seasonEnrolled } = await supabaseAdmin
          .from("prize_pot_entries")
          .select("prize_pot_id")
          .eq("profile_id", profileId)
          .in("prize_pot_id", seasonPotIds);

        const enrolledSeasonPotIds = new Set((seasonEnrolled ?? []).map((e: any) => e.prize_pot_id));
        const unenrolledSeasonPots = seasonPots.filter((p: any) => !enrolledSeasonPotIds.has(p.id));
        season_mandatory_pots = unenrolledSeasonPots.filter((p: any) => p.is_mandatory);
        season_optional_pots = unenrolledSeasonPots.filter((p: any) => !p.is_mandatory);
      }
    }

    // ── 4. Group-level charges ────────────────────────────────────────────────
    const { data: groupCharges } = await supabaseAdmin
      .from("group_charges")
      .select("*")
      .eq("group_id", event.group_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    const group_mandatory_charges = (groupCharges ?? []).filter((c: any) => c.is_mandatory);
    const group_optional_charges = (groupCharges ?? []).filter((c: any) => !c.is_mandatory);

    // ── 5. Current balance ────────────────────────────────────────────────────
    const { data: txRows } = await supabaseAdmin
      .from("group_balance_transactions")
      .select("amount")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId);

    const current_balance = (txRows ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);

    // ── 6. Projected balance (mandatory costs only as baseline) ───────────────
    const entryFee = (event as any).entry_fee_amount as number | null;
    const mandatoryChargesTotal = mandatory_charges.reduce((s: number, c: any) => s + Number(c.amount), 0);
    const mandatoryPotsTotal = [...mandatory_prize_pots, ...season_mandatory_pots]
      .reduce((s: number, p: any) => s + (p.entry_fee_amount ? Number(p.entry_fee_amount) : 0), 0);
    const groupMandatoryTotal = group_mandatory_charges.reduce((s: number, c: any) => s + Number(c.amount), 0);

    const projected_balance =
      current_balance +
      (entryFee ?? 0) +
      mandatoryChargesTotal +
      mandatoryPotsTotal +
      groupMandatoryTotal;

    return NextResponse.json(
      {
        mandatory_charges,
        optional_charges,
        mandatory_prize_pots,
        optional_prize_pots,
        season_mandatory_pots,
        season_optional_pots,
        group_mandatory_charges,
        group_optional_charges,
        entry_fee_amount: entryFee,
        current_balance,
        projected_balance,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

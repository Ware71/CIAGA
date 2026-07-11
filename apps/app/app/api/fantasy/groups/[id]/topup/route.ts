import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { readFantasyConfig } from "@/lib/fantasy/config";
import {
  getGroupFantasyContext,
  getGroupRole,
  getWalletSummary,
  recordTopUp,
  resolveWalletScope,
} from "@/lib/fantasy/wallet";

export const runtime = "nodejs";

const MAX_TOPUP_UNITS = 100;

// POST /api/fantasy/groups/[id]/topup — self-serve top-up (topup mode only)
// Body: { units: number, eventId?: string }  → credits units × topupIncrement.
// Top-ups never count toward PnL, so they can't game the leaderboard.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const role = await getGroupRole(id, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const ctx = await getGroupFantasyContext(id);
    if (!ctx) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    const config = readFantasyConfig(ctx.fantasyConfig);
    if (!config) {
      return NextResponse.json({ error: "Fantasy picks are not enabled for this group" }, { status: 400 });
    }
    if (config.mode !== "topup" || !config.topupIncrement) {
      return NextResponse.json({ error: "Top-ups are not enabled for this group" }, { status: 400 });
    }

    const body = await req.json();
    const units = body?.units;
    if (!Number.isInteger(units) || units < 1 || units > MAX_TOPUP_UNITS) {
      return NextResponse.json(
        { error: `units must be a whole number between 1 and ${MAX_TOPUP_UNITS}` },
        { status: 400 }
      );
    }

    if (config.budgetScope === "event" && !body?.eventId) {
      return NextResponse.json(
        { error: "eventId is required for event-budget groups" },
        { status: 400 }
      );
    }

    const scope = await resolveWalletScope(id, config, body?.eventId ?? null);
    const credited = await recordTopUp(id, profileId, config, scope, units);
    const { summary } = await getWalletSummary(id, profileId, config, scope);

    return NextResponse.json({ credited, summary });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { readFantasyConfig } from "@/lib/fantasy/config";
import {
  getGroupFantasyContext,
  getGroupRole,
  getWalletSummary,
  resolveWalletScope,
} from "@/lib/fantasy/wallet";

export const runtime = "nodejs";

// GET /api/fantasy/groups/[id]/wallet[?event_id=…]
// Returns the caller's balance (scoped per group config), PnL, and ledger.
// Ensures the scope's starting budget grant exists (idempotent).
// event_id is required when the group is event-budget-scoped.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const eventId = new URL(req.url).searchParams.get("event_id");
    if (config.budgetScope === "event" && !eventId) {
      return NextResponse.json(
        { error: "event_id is required for event-budget groups" },
        { status: 400 }
      );
    }

    const scope = await resolveWalletScope(id, config, eventId);
    const { summary, ledger } = await getWalletSummary(id, profileId, config, scope);

    return NextResponse.json(
      { config, summary, ledger },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

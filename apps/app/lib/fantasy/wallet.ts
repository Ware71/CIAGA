import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  FantasyConfig,
  FantasyWalletTransaction,
  FantasyWalletSummary,
  WalletScope,
} from "@/lib/fantasy/types";
import { PNL_TRANSACTION_TYPES } from "@/lib/fantasy/types";

/**
 * Server-only wallet helpers. All writes here run with the service-role client;
 * callers are responsible for auth + membership checks first.
 */

export async function getGroupFantasyContext(groupId: string): Promise<{
  fantasyConfig: unknown;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("major_groups")
    .select("fantasy_config")
    .eq("id", groupId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { fantasyConfig: (data as { fantasy_config: unknown }).fantasy_config };
}

/** Caller's active membership role in a group, or null when not an active member. */
export async function getGroupRole(
  groupId: string,
  profileId: string
): Promise<"owner" | "admin" | "member" | null> {
  const { data, error } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return (data as { role: "owner" | "admin" | "member" } | null)?.role ?? null;
}

/**
 * Resolve the ledger scope for a group per its budgetScope config.
 * Season-scoped groups fall back to a group-lifetime scope when no season
 * is active (so fantasy still works for groups that never created seasons).
 */
export async function resolveWalletScope(
  groupId: string,
  config: FantasyConfig,
  eventId?: string | null
): Promise<WalletScope> {
  if (config.budgetScope === "event") {
    if (!eventId) throw new Error("eventId required for event-scoped fantasy wallets");
    return { kind: "event", eventId };
  }

  const { data, error } = await supabaseAdmin
    .from("group_seasons")
    .select("id, status, start_date, end_date")
    .eq("group_id", groupId)
    .order("start_date", { ascending: false });
  if (error) throw error;

  const seasons = (data ?? []) as {
    id: string;
    status: string;
    start_date: string;
    end_date: string;
  }[];

  const active = seasons.find((s) => s.status === "active");
  if (active) return { kind: "season", groupSeasonId: active.id };

  const today = new Date().toISOString().slice(0, 10);
  const covering = seasons.find((s) => s.start_date <= today && s.end_date >= today);
  if (covering) return { kind: "season", groupSeasonId: covering.id };

  return { kind: "lifetime" };
}

function rowMatchesScope(tx: FantasyWalletTransaction, scope: WalletScope): boolean {
  if (scope.kind === "season") return tx.group_season_id === scope.groupSeasonId;
  if (scope.kind === "event") return tx.event_id === scope.eventId;
  // Lifetime = the whole group wallet (pick rows still carry event_id for
  // linkage, so presence of scope columns can't be the filter).
  return true;
}

/**
 * Idempotently grant the scope's starting budget to a player.
 * Uniqueness is enforced by partial unique indexes; a 23505 means another
 * request already granted — treated as success.
 */
export async function ensureBudgetGrant(
  groupId: string,
  profileId: string,
  config: FantasyConfig,
  scope: WalletScope
): Promise<void> {
  const { error } = await supabaseAdmin.from("fantasy_wallet_transactions").insert({
    group_id: groupId,
    profile_id: profileId,
    group_season_id: scope.kind === "season" ? scope.groupSeasonId : null,
    event_id: scope.kind === "event" ? scope.eventId : null,
    type: "budget_grant",
    amount: config.budgetAmount,
    note: "Starting budget",
  });
  if (error && error.code !== "23505") throw error;
}

/** All of a player's fantasy transactions in a group, newest first. */
export async function getLedger(
  groupId: string,
  profileId: string
): Promise<FantasyWalletTransaction[]> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_wallet_transactions")
    .select("*")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FantasyWalletTransaction[];
}

/**
 * Balance (scoped) + PnL from a single ledger fetch.
 * PnL sums stake/payout/cashout/void_refund only, so grants and top-ups can
 * never inflate it — this is what the fantasy leaderboard ranks by.
 */
export function summarizeLedger(
  ledger: FantasyWalletTransaction[],
  scope: WalletScope
): FantasyWalletSummary {
  let balance = 0;
  let pnl = 0;
  for (const tx of ledger) {
    const amount = Number(tx.amount);
    if (rowMatchesScope(tx, scope)) balance += amount;
    if (PNL_TRANSACTION_TYPES.includes(tx.type)) pnl += amount;
  }
  return { scope, balance: round2(balance), pnl: round2(pnl) };
}

export async function getWalletSummary(
  groupId: string,
  profileId: string,
  config: FantasyConfig,
  scope: WalletScope
): Promise<{ summary: FantasyWalletSummary; ledger: FantasyWalletTransaction[] }> {
  await ensureBudgetGrant(groupId, profileId, config, scope);
  const ledger = await getLedger(groupId, profileId);
  return { summary: summarizeLedger(ledger, scope), ledger };
}

/** Record a self-serve top-up of `units × topupIncrement` points. */
export async function recordTopUp(
  groupId: string,
  profileId: string,
  config: FantasyConfig,
  scope: WalletScope,
  units: number
): Promise<number> {
  const increment = config.topupIncrement ?? 0;
  const amount = units * increment;
  if (config.mode !== "topup" || increment < 1 || amount < 1) {
    throw new Error("Top-ups are not enabled for this group");
  }
  const { error } = await supabaseAdmin.from("fantasy_wallet_transactions").insert({
    group_id: groupId,
    profile_id: profileId,
    group_season_id: scope.kind === "season" ? scope.groupSeasonId : null,
    event_id: scope.kind === "event" ? scope.eventId : null,
    type: "topup",
    amount,
    note: `Top-up ×${units}`,
  });
  if (error) throw error;
  return amount;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

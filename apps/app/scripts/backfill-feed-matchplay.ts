// apps/app/scripts/backfill-feed-matchplay.ts
//
// One-time backfill: recompute the stored matchplay result on round_played feed cards.
//
// Why: `format_winner`, `format_label` and `players[].format_score` are computed once at
// round-completion and stored in `feed_items.payload`. The feed card renders the stored value, so
// existing matchplay cards keep the old (buggy) winner line even after the determineWinner fix
// shipped. This recomputes those fields with the current production logic and UPDATEs the row.
//
// Scope: only `type = 'round_played'` items whose stored `payload.format_type === 'matchplay'`.
// Only the format fields are touched — gross/net/par/etc are left untouched.
//
// Usage (run from apps/app so the @/ alias resolves to apps/app/*):
//   cd apps/app && npx tsx scripts/backfill-feed-matchplay.ts            # dry-run (no writes)
//   cd apps/app && npx tsx scripts/backfill-feed-matchplay.ts --apply    # write changes
//
// Target DB: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment if set,
// otherwise loaded from apps/app/.env.local. The resolved URL is printed before any work.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Load env from apps/app/.env.local unless the target was already provided via process.env
// (so prod can be targeted explicitly: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...).
function loadEnvFallback() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const path = join(here, "..", ".env.local");
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch {
    // ignore — handled by the guard below
  }
}
loadEnvFallback();

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// supabaseAdmin is a lazy Proxy (reads env on first query), so importing after env is set is fine.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { computeFormatSummaryForFeed } from "@/lib/feed/helpers/formatSummary";

const APPLY = process.argv.includes("--apply");

type FeedItemRow = { id: string; payload: any };
type PartInfo = { profile_id: string | null; display_name: string | null };

async function fetchAllRoundPlayed(): Promise<FeedItemRow[]> {
  const out: FeedItemRow[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("feed_items")
      .select("id, payload")
      .eq("type", "round_played")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as FeedItemRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function participantMap(roundId: string): Promise<Map<string, PartInfo>> {
  const { data, error } = await supabaseAdmin
    .from("round_participants")
    .select("id, profile_id, display_name")
    .eq("round_id", roundId);
  if (error) throw error;
  const m = new Map<string, PartInfo>();
  for (const r of (data ?? []) as any[]) {
    m.set(r.id, { profile_id: r.profile_id ?? null, display_name: r.display_name ?? null });
  }
  return m;
}

// Map a payload player back to its round_participants.id: by profile_id, then by name (guests).
function findParticipantId(player: any, parts: Map<string, PartInfo>): string | null {
  if (player?.profile_id) {
    for (const [pid, info] of parts) {
      if (info.profile_id && info.profile_id === player.profile_id) return pid;
    }
  }
  if (player?.name) {
    for (const [pid, info] of parts) {
      if (!info.profile_id && info.display_name && info.display_name === player.name) return pid;
    }
  }
  return null;
}

// Derive the winner line from the stored per-player format_score, using the same rule as the
// fixed determineWinner(). Used as a fallback when the round can no longer be recomputed (e.g.
// the round was deleted but the feed card still renders from its stored payload).
// Returns the corrected format_winner string, or the existing value if nothing can be derived.
function deriveWinnerFromScores(payload: any): string | null {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  const strs = players.filter((p: any) => typeof p?.format_score === "string");
  // Decided match → winner's score is prefixed "W "; otherwise the leader's score ends in "UP".
  let w = strs.find((p: any) => (p.format_score as string).startsWith("W "));
  if (!w) w = strs.find((p: any) => /UP$/.test((p.format_score as string).trim()));
  if (w) {
    const result = (w.format_score as string).replace(/^W\s+/, "");
    return `${w.name ?? "Player"} won (${result})`;
  }
  if (strs.some((p: any) => p.format_score === "AS")) return "Match halved";
  return payload?.format_winner ?? null;
}

async function main() {
  console.log(`Target: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`Mode:   ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log("");

  const items = await fetchAllRoundPlayed();
  console.log(`round_played items: ${items.length}`);

  let matchplay = 0;
  let changed = 0;
  let skipped = 0;
  let fellBack = 0;

  for (const item of items) {
    const payload = item.payload ?? {};
    if (payload?.format_type !== "matchplay") continue;
    matchplay++;

    const roundId = payload.round_id;
    if (!roundId) {
      skipped++;
      continue;
    }

    let summary;
    try {
      summary = await computeFormatSummaryForFeed(roundId);
    } catch (e: any) {
      console.warn(`  ! ${roundId}: recompute failed (${e?.message ?? e}); using payload fallback`);
    }

    const next = JSON.parse(JSON.stringify(payload));

    if (summary) {
      // Authoritative recompute (round data still exists).
      const parts = await participantMap(roundId);
      next.format_winner = summary.format_winner ?? null;
      next.format_label = summary.format_label ?? next.format_label ?? null;
      next.format_type = summary.format_type ?? next.format_type ?? null;
      next.side_game_results = summary.side_game_results ?? next.side_game_results ?? null;
      if (Array.isArray(next.players)) {
        for (const pl of next.players) {
          const pid = findParticipantId(pl, parts);
          if (!pid) continue;
          const score = summary.player_scores.get(pid);
          if (score !== undefined) pl.format_score = score;
        }
      }
    } else {
      // Fallback: round can't be recomputed (e.g. deleted) — fix the winner line from stored scores.
      fellBack++;
      next.format_winner = deriveWinnerFromScores(payload);
    }

    if (JSON.stringify(payload) === JSON.stringify(next)) continue;

    changed++;
    console.log(`  ~ ${roundId}`);
    console.log(
      `      winner: ${JSON.stringify(payload.format_winner)} -> ${JSON.stringify(next.format_winner)}`,
    );

    if (APPLY) {
      const { error } = await supabaseAdmin.from("feed_items").update({ payload: next }).eq("id", item.id);
      if (error) throw error;
    }
  }

  console.log("");
  console.log(
    `Done. matchplay=${matchplay} changed=${changed} fallback=${fellBack} skipped=${skipped} ${APPLY ? "(applied)" : "(dry-run)"}`,
  );
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readAllPages } from "@/lib/fantasy/paginate";

/**
 * The event-scoped reads that can outgrow PostgREST's 1000-row cap, in one
 * place, each with a TOTAL ORDER.
 *
 * Both of these used to be written inline at every call site — some
 * unpaginated, one hand-rolling its own `range()` loop with no ordering at all.
 * That last one is not a hypothetical: `fantasy_odds_snapshots` carries 1,265
 * active rows for The International 2026, so the board took the second page,
 * and `range()` over an unordered select has no defined row-to-page assignment.
 * Rows get served twice or skipped entirely at the boundary.
 *
 * It lands on a whole market rather than scattering because `writeSnapshots`
 * upserts a market's selections together, so its rows are physically adjacent —
 * a shifted boundary drops one market's entire selection set. Downstream,
 * `marketsInTab` drops any market with no selections, and the board rendered
 * the wrong book under the missing one's label. Non-deterministic, so the data
 * looks perfectly healthy when you go and check it.
 *
 * Ordering by `id` (the primary key) is what makes paging well-defined. Do not
 * order by `event_version` or `computed_at` — they repeat across a whole
 * snapshot generation, which is the same bug wearing a hat.
 */

/** Minimal shape we need from the client; injectable so tests need no Supabase. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QueryRoot = { from: (table: string) => any };

/** Every ACTIVE odds snapshot for an event, across all pages. */
export function readActiveSnapshots<T>(
  eventId: string,
  columns: string,
  db: QueryRoot = supabaseAdmin
): Promise<T[]> {
  return readAllPages<T>(() =>
    db
      .from("fantasy_odds_snapshots")
      .select(columns)
      .eq("event_id", eventId)
      .eq("status", "active")
      .order("id")
  );
}

/** Every market for an event, across all pages. */
export function readEventMarkets<T>(
  eventId: string,
  columns: string,
  db: QueryRoot = supabaseAdmin
): Promise<T[]> {
  return readAllPages<T>(() =>
    db.from("fantasy_markets").select(columns).eq("event_id", eventId).order("id")
  );
}

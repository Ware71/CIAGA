/**
 * Read every row a PostgREST filter matches, not just the first page.
 *
 * PostgREST caps a response at 1000 rows and says nothing when it truncates, so
 * an unpaginated `.select()` on a table that can exceed that silently drops
 * data. In fantasy that has cost us real money twice: The International lost 54
 * markets to a truncated read (F8), and the cash-out estimators read
 * `fantasy_odds_snapshots` unpaginated — 777 active rows for the Championship's
 * 120 markets, and The International carries 236.
 *
 * The caller MUST supply a total order (see `orderBy`). `range()` over an
 * unordered — or non-uniquely-ordered — select has no defined row-to-page
 * assignment, so rows at an equal sort key can be served twice or skipped
 * entirely at a page boundary. Ordering by a non-unique column alone is exactly
 * this bug: `event_version` repeats across a whole snapshot generation.
 */
export const POSTGREST_PAGE_SIZE = 1000;

type Pageable<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
};

/**
 * @param build  Applies filters AND a total order to a fresh query. Called once
 *               per page — it must be a builder, not a shared query object,
 *               because PostgREST query builders are single-use.
 */
export async function readAllPages<T>(build: () => Pageable<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await build().range(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < POSTGREST_PAGE_SIZE) break;
  }
  return rows;
}

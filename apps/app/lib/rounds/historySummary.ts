import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * One compact row per finished round, everything the history screen's
 * whole-career aggregates need — assembled server-side in one place instead of
 * three unbounded round trips from the phone (all round_participants, a
 * browser-side chunked handicap_round_results loop, and the entire
 * handicap_index_history + a per-round binary search).
 *
 * Deliberately excludes the heavy per-hole data (gross totals, WHS penalties,
 * tee names): that stays paginated in HistoryClient's `loadSupplemental`, which
 * already loads it a page at a time.
 */
export type HistorySummaryRound = {
  round_id: string;
  participant_id: string;
  tee_snapshot_id: string | null;
  name: string | null;
  status: string;
  started_at: string | null;
  created_at: string | null;
  course_id: string | null;
  course_name: string | null;
  adjusted_gross_score: number | null;
  score_differential: number | null;
  handicap_index_used: number | null;
  course_handicap_used: number | null;
  /** Handicap index in effect immediately after this round (tooltip). */
  hi_after: number | null;
};

// Kept in sync with HistoryClient's FINISHED_STATUSES.
const FINISHED_STATUSES = ["finished", "completed", "ended"];

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function getRoundHistorySummary(profileId: string): Promise<HistorySummaryRound[]> {
  // 1) Finished rounds for this profile — the finished-only cut is pushed into
  //    Postgres via !inner + the status filter (same as HistoryClient).
  const { data: parts, error } = await supabaseAdmin
    .from("round_participants")
    .select(
      `
        id,
        round_id,
        tee_snapshot_id,
        rounds:rounds!round_id!inner (
          id, name, status, started_at, created_at, course_id,
          courses:courses ( name )
        )
      `
    )
    .eq("profile_id", profileId)
    .in("rounds.status", FINISHED_STATUSES);

  if (error) throw error;

  type PartRow = {
    id: string;
    round_id: string;
    tee_snapshot_id: string | null;
    rounds: any;
  };

  const base = ((parts ?? []) as PartRow[])
    .map((pr) => {
      const round = one(pr.rounds);
      if (!round) return null;
      const course = one(round.courses);
      return {
        round_id: round.id as string,
        participant_id: pr.id,
        tee_snapshot_id: pr.tee_snapshot_id ?? null,
        name: round.name ?? null,
        status: round.status as string,
        started_at: round.started_at ?? null,
        created_at: round.created_at ?? null,
        course_id: round.course_id ?? null,
        course_name: course?.name ?? null,
      };
    })
    .filter(Boolean) as Array<Omit<HistorySummaryRound, "adjusted_gross_score" | "score_differential" | "handicap_index_used" | "course_handicap_used" | "hi_after">>;

  // 2) handicap_round_results, keyed by round. Chunked server-side against the
  //    Postgres IN-list limit; the round trips here are co-located with the DB.
  const participantIds = Array.from(new Set(base.map((r) => r.participant_id)));
  const hrrByRound = new Map<
    string,
    { ags: number | null; sd: number | null; hiUsed: number | null; chcp: number | null }
  >();

  for (const ids of chunk(participantIds, 500)) {
    const { data: hrr } = await supabaseAdmin
      .from("handicap_round_results")
      .select(
        "round_id, participant_id, adjusted_gross_score, score_differential, handicap_index_used, course_handicap_used"
      )
      .in("participant_id", ids);

    for (const row of (hrr ?? []) as any[]) {
      hrrByRound.set(row.round_id as string, {
        ags: toNum(row.adjusted_gross_score),
        sd: toNum(row.score_differential),
        hiUsed: toNum(row.handicap_index_used),
        chcp: toNum(row.course_handicap_used),
      });
    }
  }

  // 3) Handicap index history → "HI after" per round. The binary search that
  //    used to run in the browser (once per round) runs here instead, so the
  //    client never transfers the history nor searches it.
  const { data: hist } = await supabaseAdmin
    .from("handicap_index_history")
    .select("as_of_date, handicap_index")
    .eq("profile_id", profileId)
    .not("handicap_index", "is", null)
    .order("as_of_date", { ascending: true });

  const histRows = ((hist ?? []) as any[])
    .map((r) => ({ as_of_date: String(r.as_of_date), handicap_index: Number(r.handicap_index) }))
    .filter((r) => r.as_of_date && Number.isFinite(r.handicap_index));

  function hiAsOfInclusive(dateIso: string | null): number | null {
    if (!dateIso || !histRows.length) return null;
    const target = new Date(dateIso).getTime();
    if (!Number.isFinite(target)) return null;

    let lo = 0;
    let hi = histRows.length - 1;
    let bestIdx = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = new Date(histRows[mid].as_of_date).getTime();
      if (!Number.isFinite(t)) {
        lo = mid + 1;
        continue;
      }
      if (t <= target) {
        bestIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return bestIdx >= 0 ? histRows[bestIdx].handicap_index : null;
  }

  return base.map((r) => {
    const hrr = hrrByRound.get(r.round_id);
    return {
      ...r,
      adjusted_gross_score: hrr?.ags ?? null,
      score_differential: hrr?.sd ?? null,
      handicap_index_used: hrr?.hiUsed ?? null,
      course_handicap_used: hrr?.chcp ?? null,
      hi_after: hiAsOfInclusive(r.started_at ?? r.created_at),
    };
  });
}

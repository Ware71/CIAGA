import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type {
  FeedItemVM,
  FeedItemDetail,
  RoundDetailPlayer,
  HoleRow,
  H2HTally,
  MatchplayDetail,
  FormatChart,
  FormatChartSeries,
} from "@/lib/feed/types";
import { strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";
import { computeFormatDisplay } from "@/lib/rounds/formatScoring";
import type { Participant, Hole, Score, HoleState, Team } from "@/lib/rounds/hooks/useRoundDetail";

/**
 * Compute the type-specific detail shown below the summary card on the
 * feed-item detail page. All data is sourced from existing tables/views:
 * - get_round_detail_snapshot (per-hole scores, pars, SI, participants, format)
 * - round_course_snapshots / round_tee_snapshots / round_current_scores (hole stats)
 * - v_course_record_rounds (PB previous best, course-record beaten)
 *
 * Best-effort: returns null on missing data rather than throwing.
 */
export async function getFeedItemDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  try {
    if (item.type === "round_played") return await roundDetail(item);
    if (item.type === "hole_event") return await holeEventDetail(item);
    if (item.type === "pb") return await pbDetail(item);
    if (item.type === "course_record") return await courseRecordDetail(item);
    return null;
  } catch {
    return null;
  }
}

function numOrNull(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── Round progression (gross + net, + matchplay extras) ──────────────

async function roundDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const payload: any = item.payload ?? {};
  const roundId = payload.round_id;
  if (typeof roundId !== "string") return null;

  const { data, error } = await supabaseAdmin.rpc("get_round_detail_snapshot", { _round_id: roundId });
  if (error || !data?.round) return null;

  const tee = data.tee_snapshot ?? null;
  const holesCount: number = tee?.holes_count ?? (data.holes?.length || 18);

  const parByHole = new Map<number, number | null>();
  const siByHole = new Map<number, number | null>();
  for (const h of (data.holes ?? []) as any[]) {
    parByHole.set(h.hole_number, h.par ?? null);
    siByHole.set(h.hole_number, h.stroke_index ?? null);
  }

  // participant_id → { hole_number → strokes }
  const scoresByPart = new Map<string, Map<number, number>>();
  for (const s of (data.scores ?? []) as any[]) {
    const pid = s.participant_id as string;
    const hn = s.hole_number as number;
    const strokes = numOrNull(s.strokes);
    if (!pid || !hn || strokes === null) continue;
    if (!scoresByPart.has(pid)) scoresByPart.set(pid, new Map());
    scoresByPart.get(pid)!.set(hn, strokes);
  }

  const rawParticipants = (data.participants ?? []) as any[];

  // playing_handicap_used / team via participant_extras (like useRoundDetail)
  const extrasById = new Map<string, any>();
  for (const e of (data.participant_extras ?? []) as any[]) extrasById.set(e.id, e);

  const teeMeta = {
    slope: numOrNull(tee?.slope),
    rating: numOrNull(tee?.rating),
    par_total: numOrNull(tee?.par_total),
    holes_count: tee?.holes_count ?? 18,
  };
  const resolveCH = (rp: any): number | null => {
    const direct =
      numOrNull(rp.course_handicap) ?? numOrNull(rp.course_handicap_computed) ?? numOrNull(rp.course_handicap_used);
    if (direct !== null) return direct;
    const hi =
      numOrNull(rp.handicap_index) ??
      numOrNull(rp.handicap_index_computed) ??
      numOrNull(rp.handicap_index_used) ??
      numOrNull(extrasById.get(rp.id)?.handicap_index);
    if (hi === null || teeMeta.slope === null || teeMeta.rating === null || teeMeta.par_total === null) return null;
    const effHi = teeMeta.holes_count === 9 ? hi / 2 : hi;
    return Math.round(effHi * (teeMeta.slope / 113) + (teeMeta.rating - teeMeta.par_total));
  };

  // Chart players = participants with scores, in a stable order (p0..pN).
  const chartParts = rawParticipants.filter((rp) => scoresByPart.has(rp.id));
  if (!chartParts.length) return null;

  const players: RoundDetailPlayer[] = chartParts.map((rp, i) => ({
    key: `p${i}`,
    name: rp.name ?? rp.display_name ?? "Player",
    avatar_url: rp.avatar_url ?? null,
  }));

  const chById = new Map<string, number | null>();
  for (const rp of chartParts) chById.set(rp.id, resolveCH(rp));

  const grossAt = (id: string, hole: number): number | undefined => scoresByPart.get(id)?.get(hole);
  const netAt = (id: string, hole: number): number | undefined => {
    const s = scoresByPart.get(id)?.get(hole);
    if (typeof s !== "number") return undefined;
    return s - strokesReceivedOnHole(chById.get(id) ?? null, siByHole.get(hole) ?? null, holesCount);
  };

  const gross_rows = buildRows(chartParts, holesCount, parByHole, grossAt);
  const net_rows = buildRows(chartParts, holesCount, parByHole, netAt);

  // Format-aware progression chart (stableford points / matchplay margin / …).
  const formatType: string | null = typeof data.round?.format_type === "string" ? data.round.format_type : null;
  const fmtInputs = buildFormatInputs(data, rawParticipants, extrasById);
  const format_chart = buildFormatChart(formatType, fmtInputs, chartParts, holesCount, payload.format_label);

  // Matchplay head-to-head (1v1 only).
  let matchplay: MatchplayDetail | null = null;
  if (formatType && formatType.startsWith("matchplay")) {
    matchplay = await buildH2H(item);
  }

  return { kind: "round", holes_count: holesCount, players, gross_rows, net_rows, format_chart, matchplay };
}

function buildRows(
  participants: Array<{ id: string }>,
  holesCount: number,
  parByHole: Map<number, number | null>,
  valueAt: (partId: string, hole: number) => number | undefined,
): HoleRow[] {
  const cumVal = new Map<string, number>();
  const cumPar = new Map<string, number>();
  const completed = new Map<string, number>();
  const rows: HoleRow[] = [];

  for (let hole = 1; hole <= holesCount; hole++) {
    const par = parByHole.get(hole) ?? null;

    participants.forEach((rp) => {
      const v = valueAt(rp.id, hole);
      if (typeof v === "number") {
        cumVal.set(rp.id, (cumVal.get(rp.id) ?? 0) + v);
        if (par !== null) cumPar.set(rp.id, (cumPar.get(rp.id) ?? 0) + par);
        completed.set(rp.id, (completed.get(rp.id) ?? 0) + 1);
      }
    });

    const ranked = participants
      .filter((rp) => (completed.get(rp.id) ?? 0) > 0)
      .map((rp) => ({ id: rp.id, v: cumVal.get(rp.id) ?? 0 }))
      .sort((a, b) => a.v - b.v);

    const rankById = new Map<string, number>();
    let lastV: number | null = null;
    let lastRank = 0;
    ranked.forEach((r, idx) => {
      const rank = lastV !== null && r.v === lastV ? lastRank : idx + 1;
      rankById.set(r.id, rank);
      lastV = r.v;
      lastRank = rank;
    });

    const row: HoleRow = { hole };
    participants.forEach((rp, i) => {
      const has = (completed.get(rp.id) ?? 0) > 0;
      row[`p${i}`] = has ? (cumVal.get(rp.id) ?? 0) - (cumPar.get(rp.id) ?? 0) : null;
      row[`p${i}_rank`] = has ? rankById.get(rp.id) ?? null : null;
    });
    rows.push(row);
  }

  return rows;
}

// ── Matchplay: per-match margin lines + dual head-to-head ────────────

function parseMargin(dv: any): number | null {
  if (typeof dv !== "string") return null;
  if (dv === "AS") return 0;
  const m = dv.match(/^(\d+)(UP|DN)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return m[2] === "UP" ? n : -n;
}

/** Map a round snapshot into the inputs the format-scoring functions expect. */
function buildFormatInputs(snap: any, rawParticipants: any[], extrasById: Map<string, any>) {
  const nameById = new Map<string, string>();
  for (const rp of rawParticipants) nameById.set(rp.id, rp.name ?? rp.display_name ?? "Player");

  const participants = rawParticipants.map(
    (rp) =>
      ({
        id: rp.id,
        profile_id: rp.profile_id ?? null,
        is_guest: !!rp.is_guest,
        display_name: rp.display_name ?? rp.name ?? "Player",
        role: rp.role ?? "player",
        tee_snapshot_id: rp.tee_snapshot_id ?? null,
        team_id: extrasById.get(rp.id)?.team_id ?? null,
        playing_handicap_used: numOrNull(extrasById.get(rp.id)?.playing_handicap_used),
        course_handicap: numOrNull(rp.course_handicap),
      }) as unknown as Participant,
  );

  const holes: Hole[] = ((snap.holes ?? []) as any[]).map((h) => ({
    hole_number: h.hole_number,
    par: h.par ?? null,
    yardage: h.yardage ?? null,
    stroke_index: h.stroke_index ?? null,
  }));

  const scoresByKey: Record<string, Score> = {};
  for (const s of (snap.scores ?? []) as any[]) {
    scoresByKey[`${s.participant_id}:${s.hole_number}`] = {
      participant_id: s.participant_id,
      hole_number: s.hole_number,
      strokes: numOrNull(s.strokes),
      created_at: s.created_at ?? "",
    } as Score;
  }

  const holeStatesByKey: Record<string, HoleState> = {};
  for (const hs of (snap.hole_states ?? []) as any[]) {
    const status = hs.status as string;
    if (status === "completed" || status === "picked_up" || status === "not_started") {
      holeStatesByKey[`${hs.participant_id}:${hs.hole_number}`] = status as HoleState;
    }
  }

  const teams: Team[] = ((snap.teams ?? []) as any[]).map((t) => ({
    id: t.id,
    round_id: t.round_id,
    name: t.name ?? `Team ${t.team_number}`,
    team_number: t.team_number,
  }));

  const formatConfig: Record<string, any> =
    typeof snap.round?.format_config === "object" && snap.round.format_config ? snap.round.format_config : {};

  return { participants, holes, scoresByKey, holeStatesByKey, teams, formatConfig, nameById };
}

/**
 * Build the "Format" line-chart view:
 * - matchplay → one margin series per match (1up/1down).
 * - points formats (stableford/skins/wolf) → cumulative points per player.
 * - strokeplay / unsupported → null (no Format toggle).
 */
function buildFormatChart(
  formatType: string | null,
  inputs: ReturnType<typeof buildFormatInputs>,
  chartParts: any[],
  holesCount: number,
  formatLabel: any,
): FormatChart | null {
  if (!formatType || formatType === "strokeplay" || formatType === "team_strokeplay") return null;

  const { participants, holes, scoresByKey, holeStatesByKey, teams, formatConfig, nameById } = inputs;

  let datas: Array<{
    tabLabel?: string;
    holeResults?: Record<string, any>;
    filteredParticipantIds?: string[];
    higherIsBetter?: boolean;
  }> = [];
  try {
    datas = computeFormatDisplay(
      formatType as any,
      formatConfig,
      participants,
      holes,
      scoresByKey,
      holeStatesByKey,
      teams,
      (p) => nameById.get(p.id) ?? "Player",
    ) as any;
  } catch {
    return null;
  }
  if (!datas.length) return null;

  // Matchplay → margin lines (one per match).
  if (formatType.startsWith("matchplay")) {
    const series: FormatChartSeries[] = [];
    const rowByHole = new Map<number, HoleRow>();
    for (let hole = 1; hole <= holesCount; hole++) rowByHole.set(hole, { hole });

    datas.forEach((md, idx) => {
      const refId = md.filteredParticipantIds?.[0] ?? "";
      const key = `m${idx}`;
      series.push({ key, name: md.tabLabel ?? `Match ${idx + 1}` });
      for (let hole = 1; hole <= holesCount; hole++) {
        rowByHole.get(hole)![key] = parseMargin(md.holeResults?.[`${refId}:${hole}`]?.displayValue);
      }
    });
    if (!series.length) return null;

    return {
      label: typeof formatLabel === "string" ? formatLabel : "Match",
      kind: "margin",
      series,
      rows: Array.from(rowByHole.values()),
      higher_is_better: false,
    };
  }

  // Points formats → cumulative numeric points per player.
  const fd = datas[0];
  const cum = new Map<string, number>();
  const completed = new Map<string, number>();
  const rows: HoleRow[] = [];
  let numericFound = false;

  for (let hole = 1; hole <= holesCount; hole++) {
    chartParts.forEach((rp) => {
      const dv = fd.holeResults?.[`${rp.id}:${hole}`]?.displayValue;
      if (typeof dv === "number") {
        cum.set(rp.id, (cum.get(rp.id) ?? 0) + dv);
        completed.set(rp.id, (completed.get(rp.id) ?? 0) + 1);
        numericFound = true;
      }
    });
    const row: HoleRow = { hole };
    chartParts.forEach((rp, i) => {
      row[`p${i}`] = (completed.get(rp.id) ?? 0) > 0 ? cum.get(rp.id) ?? 0 : null;
    });
    rows.push(row);
  }
  if (!numericFound) return null;

  const series: FormatChartSeries[] = chartParts.map((rp, i) => ({
    key: `p${i}`,
    name: rp.name ?? rp.display_name ?? "Player",
  }));

  return {
    label: typeof formatLabel === "string" ? formatLabel : fd.tabLabel ?? "Format",
    kind: "points",
    series,
    rows,
    higher_is_better: fd.higherIsBetter ?? true,
  };
}

/** Matchplay head-to-head record (1v1 only). */
async function buildH2H(item: FeedItemVM): Promise<MatchplayDetail | null> {
  const playersRaw: any[] = Array.isArray((item.payload as any)?.players) ? (item.payload as any).players : [];
  const withIds = playersRaw.filter((pl) => typeof pl.profile_id === "string");
  if (withIds.length !== 2) return null;

  const h2h = await matchplayHeadToHead(
    withIds[0].profile_id,
    withIds[1].profile_id,
    withIds[0].name ?? "A",
    withIds[1].name ?? "B",
    item.occurred_at,
  );
  return {
    a_name: h2h.a_name,
    b_name: h2h.b_name,
    all_time: h2h.all_time,
    through_this_match: h2h.through_this_match,
  };
}

async function matchplayHeadToHead(
  aId: string,
  bId: string,
  aName: string,
  bName: string,
  cutoffIso: string,
): Promise<{ a_name: string; b_name: string; all_time: H2HTally; through_this_match: H2HTally }> {
  const empty: H2HTally = { a_wins: 0, b_wins: 0, draws: 0, total: 0 };

  const { data: partRows } = await supabaseAdmin
    .from("round_participants")
    .select("round_id, profile_id")
    .in("profile_id", [aId, bId]);

  const byRound = new Map<string, Set<string>>();
  for (const r of (partRows ?? []) as any[]) {
    if (!byRound.has(r.round_id)) byRound.set(r.round_id, new Set());
    byRound.get(r.round_id)!.add(r.profile_id);
  }
  const sharedRoundIds = [...byRound.entries()].filter(([, s]) => s.has(aId) && s.has(bId)).map(([rid]) => rid);
  if (!sharedRoundIds.length) {
    return { a_name: aName, b_name: bName, all_time: { ...empty }, through_this_match: { ...empty } };
  }

  const groupKeys = sharedRoundIds.map((rid) => `round:${rid}`);
  const { data: feedRows } = await supabaseAdmin
    .from("feed_items")
    .select("occurred_at, payload")
    .in("group_key", groupKeys);

  const cutoff = Date.parse(cutoffIso);
  const all_time: H2HTally = { a_wins: 0, b_wins: 0, draws: 0, total: 0 };
  const through_this_match: H2HTally = { a_wins: 0, b_wins: 0, draws: 0, total: 0 };

  const aLower = aName.toLowerCase();
  const bLower = bName.toLowerCase();

  for (const row of (feedRows ?? []) as any[]) {
    const pl: any = row.payload ?? {};
    if (typeof pl.format_type !== "string" || !pl.format_type.startsWith("matchplay")) continue;

    const winner = String(pl.format_winner ?? "").toLowerCase();
    const halved =
      !winner ||
      winner.includes("halv") ||
      winner.includes("tie") ||
      winner.includes("all square") ||
      winner.includes(" as");
    const result: "a" | "b" | "draw" = halved
      ? "draw"
      : winner.includes(aLower)
        ? "a"
        : winner.includes(bLower)
          ? "b"
          : "draw";

    addResult(all_time, result);
    const occ = Date.parse(row.occurred_at ?? "");
    if (Number.isFinite(occ) && Number.isFinite(cutoff) && occ <= cutoff) {
      addResult(through_this_match, result);
    }
  }

  return { a_name: aName, b_name: bName, all_time, through_this_match };
}

function addResult(t: H2HTally, r: "a" | "b" | "draw") {
  t.total++;
  if (r === "a") t.a_wins++;
  else if (r === "b") t.b_wins++;
  else t.draws++;
}

// ── Hole event (par/yardage/SI + this-player & everyone stats) ───────

type HoleStat = { avg_score: number | null; plays: number; event_pct: number | null };

function holeStatBlock(strokesList: number[], kind: string, par: number | null): HoleStat {
  const plays = strokesList.length;
  if (!plays) return { avg_score: null, plays: 0, event_pct: null };
  const avg = strokesList.reduce((a, b) => a + b, 0) / plays;
  const matches = strokesList.filter((s) => {
    if (kind === "hio") return s === 1;
    if (par === null) return false;
    if (kind === "eagle") return s === par - 2;
    if (kind === "albatross") return s === par - 3;
    return false;
  }).length;
  return { avg_score: avg, plays, event_pct: (matches / plays) * 100 };
}

async function holeEventDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const p: any = item.payload ?? {};
  const holeNumber: number | null = numOrNull(p.hole_number);
  const par: number | null = numOrNull(p.par);
  const kind: string = String(p.kind ?? "");
  const eventLabel =
    kind === "hio" ? "Hole in one" : kind === "albatross" ? "Albatross" : kind === "eagle" ? "Eagle" : "Hole event";

  let yardage: number | null = numOrNull(p.yardage);
  let strokeIndex: number | null = null;

  if (typeof p.round_id === "string" && holeNumber !== null) {
    const { data } = await supabaseAdmin.rpc("get_round_detail_snapshot", { _round_id: p.round_id });
    const hole = ((data?.holes ?? []) as any[]).find((h) => h.hole_number === holeNumber);
    if (hole) {
      strokeIndex = hole.stroke_index ?? null;
      if (yardage === null) yardage = hole.yardage ?? null;
    }
  }

  let everyone: HoleStat = { avg_score: null, plays: 0, event_pct: null };
  let player: HoleStat = { avg_score: null, plays: 0, event_pct: null };

  const courseId: string | null = typeof p.course_id === "string" ? p.course_id : null;
  const teeName: string | null = typeof p.tee_name === "string" ? p.tee_name : null;
  const subjectId: string | null =
    typeof p.profile_id === "string" ? p.profile_id : item.subject?.profile_id ?? null;

  if (courseId && holeNumber !== null) {
    // All rounds at this course (every round, not just record-eligible ones).
    const { data: csnaps } = await supabaseAdmin
      .from("round_course_snapshots")
      .select("id, round_id")
      .eq("source_course_id", courseId);

    let courseRoundIds = Array.from(
      new Set((csnaps ?? []).map((s: any) => s.round_id as string).filter(Boolean)),
    );

    // Restrict to the same tee when we know it.
    if (teeName && (csnaps ?? []).length) {
      const snapIds = (csnaps ?? []).map((s: any) => s.id);
      const { data: tsnaps } = await supabaseAdmin
        .from("round_tee_snapshots")
        .select("round_course_snapshot_id, name")
        .in("round_course_snapshot_id", snapIds);
      const okSnapIds = new Set(
        (tsnaps ?? []).filter((t: any) => t.name === teeName).map((t: any) => t.round_course_snapshot_id),
      );
      const roundIdBySnap = new Map<string, string>();
      for (const s of (csnaps ?? []) as any[]) roundIdBySnap.set(s.id, s.round_id);
      const teeRoundIds = Array.from(okSnapIds)
        .map((sid) => roundIdBySnap.get(sid as string))
        .filter((x): x is string => !!x);
      if (teeRoundIds.length) courseRoundIds = Array.from(new Set(teeRoundIds));
    }

    if (courseRoundIds.length) {
      // Everyone
      const { data: allScores } = await supabaseAdmin
        .from("round_current_scores")
        .select("strokes")
        .in("round_id", courseRoundIds)
        .eq("hole_number", holeNumber);
      everyone = holeStatBlock(
        (allScores ?? []).map((r: any) => r.strokes).filter((s: any): s is number => typeof s === "number"),
        kind,
        par,
      );

      // This player
      if (subjectId) {
        const { data: subjParts } = await supabaseAdmin
          .from("round_participants")
          .select("id")
          .eq("profile_id", subjectId)
          .in("round_id", courseRoundIds);
        const partIds = (subjParts ?? []).map((r: any) => r.id).filter(Boolean);
        if (partIds.length) {
          const { data: myScores } = await supabaseAdmin
            .from("round_current_scores")
            .select("strokes")
            .in("participant_id", partIds)
            .eq("hole_number", holeNumber);
          player = holeStatBlock(
            (myScores ?? []).map((r: any) => r.strokes).filter((s: any): s is number => typeof s === "number"),
            kind,
            par,
          );
        }
      }
    }
  }

  return {
    kind: "hole_event",
    event_label: eventLabel,
    hole_number: holeNumber,
    par,
    yardage,
    stroke_index: strokeIndex,
    player,
    everyone,
  };
}

// ── Personal best (previous best at this course+tee) ─────────────────

async function pbDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const p: any = item.payload ?? {};
  const gross = numOrNull(p.gross_total);
  const profileId: string | null = typeof p.profile_id === "string" ? p.profile_id : null;
  const courseId: string | null = typeof p.course_id === "string" ? p.course_id : null;
  const teeName: string | null = typeof p.tee_name === "string" ? p.tee_name : null;
  const roundId: string | null = typeof p.round_id === "string" ? p.round_id : null;

  let previousBest: { gross: number; date: string | null } | null = null;

  if (profileId && courseId) {
    const { data: rows } = await supabaseAdmin
      .from("v_course_record_rounds")
      .select("gross_score, played_at, tee_name, round_id, is_complete")
      .eq("profile_id", profileId)
      .eq("course_id", courseId)
      .eq("is_complete", true);

    const prior = (rows ?? [])
      .filter((r: any) => (r.tee_name ?? null) === teeName && r.round_id !== roundId)
      .map((r: any) => ({ gross: r.gross_score as number, date: (r.played_at as string) ?? null }))
      .filter((r) => typeof r.gross === "number")
      .sort((a, b) => a.gross - b.gross);

    previousBest = prior[0] ?? null;
  }

  return { kind: "pb", gross, previous_best: previousBest };
}

// ── Course record (who they beat) ────────────────────────────────────

async function courseRecordDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const p: any = item.payload ?? {};
  const gross = numOrNull(p.gross_total);
  const courseId: string | null = typeof p.course_id === "string" ? p.course_id : null;
  const teeName: string | null = typeof p.tee_name === "string" ? p.tee_name : null;
  const roundId: string | null = typeof p.round_id === "string" ? p.round_id : null;

  let beat: { name: string | null; gross: number; date: string | null } | null = null;

  if (courseId) {
    const { data: rows } = await supabaseAdmin
      .from("v_course_record_rounds")
      .select("gross_score, played_at, tee_name, round_id, profile_id, is_complete")
      .eq("course_id", courseId)
      .eq("is_complete", true);

    const prior = (rows ?? [])
      .filter((r: any) => (r.tee_name ?? null) === teeName && r.round_id !== roundId)
      .map((r: any) => ({
        gross: r.gross_score as number,
        date: (r.played_at as string) ?? null,
        profile_id: r.profile_id as string | null,
      }))
      .filter((r) => typeof r.gross === "number")
      .sort((a, b) => a.gross - b.gross);

    const prev = prior[0];
    if (prev) {
      let name: string | null = null;
      if (prev.profile_id) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("name")
          .eq("id", prev.profile_id)
          .maybeSingle();
        name = (prof as any)?.name ?? null;
      }
      beat = { name, gross: prev.gross, date: prev.date };
    }
  }

  return { kind: "course_record", gross, beat };
}

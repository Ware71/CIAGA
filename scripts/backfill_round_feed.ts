// scripts/backfill_round_feed.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseFeedPayload } from "@/lib/feed/schemas";
import { fanOutFeedItemToSubjectsAndFollowers } from "@/lib/feed/fanout";

type HoleEventKind = "hio" | "albatross" | "eagle";

type RoundRow = {
  id: string;
  status: string | null;
  finished_at: string | null;
  created_at: string | null;
};

type CourseSnap = {
  id: string;
  source_course_id: string | null;
  course_name: string | null;
};

type TeeSnap = {
  id: string;
  name: string | null;
};

type ParticipantRow = {
  id: string; // round_participants.id
  profile_id: string | null;
  is_guest: boolean | null;
  display_name: string | null;
};

type ScoreRow = {
  participant_id: string;
  hole_number: number;
  strokes: number | null;
};

type HoleSnapRow = {
  hole_number: number;
  par: number | null;
};

type HandicapResultRow = {
  participant_id: string;
  course_handicap_used: number | null;
};

function isCompletedRound(r: RoundRow): boolean {
  const s = String(r.status ?? "").toLowerCase();
  if (s === "live") return false;
  if (r.finished_at) return true;
  return ["complete", "completed", "finished", "closed"].includes(s);
}

function occurredAtForRound(r: RoundRow): string {
  return r.finished_at ?? r.created_at ?? new Date().toISOString();
}

function kindFromStrokesAndPar(strokes: number, par: number): HoleEventKind | null {
  if (strokes === 1) return "hio";
  const diff = strokes - par;
  if (diff === -3) return "albatross";
  if (diff === -2) return "eagle";
  return null;
}

async function fetchAll<T>(table: string, select: string, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabaseAdmin.from(table).select(select).range(from, to);
    if (error) throw error;

    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

async function upsertSubjects(feedItemId: string, subjectProfileIds: string[], role: string) {
  const unique = Array.from(new Set(subjectProfileIds)).filter(Boolean);
  if (!unique.length) return;

  const rows = unique.map((pid) => ({
    feed_item_id: feedItemId,
    subject_profile_id: pid,
    role,
  }));

  const { error } = await supabaseAdmin
    .from("feed_item_subjects")
    .upsert(rows, { onConflict: "feed_item_id,subject_profile_id" });

  if (error) throw error;
}

async function insertFeedItemIfMissing(params: {
  type: string;
  group_key: string;
  actor_profile_id: string;
  occurred_at: string;
  payload: any;
  subjectProfileIds: string[];
  subjectRole: string;
}): Promise<string | null> {
  const { type, group_key, actor_profile_id, occurred_at, payload, subjectProfileIds, subjectRole } = params;

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("feed_items")
    .select("id")
    .eq("group_key", group_key)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing?.id) return existing.id;

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("feed_items")
    .insert({
      type,
      group_key,
      actor_profile_id,
      audience: "followers",
      visibility: "visible",
      occurred_at,
      payload,
    })
    .select("id")
    .single();

  if (insErr) throw insErr;
  if (!inserted?.id) throw new Error(`Failed to insert feed item for ${type} ${group_key}`);

  await upsertSubjects(inserted.id, subjectProfileIds, subjectRole);

  await fanOutFeedItemToSubjectsAndFollowers({
    feedItemId: inserted.id,
    actorProfileId: actor_profile_id,
    audience: "followers",
    subjectProfileIds,
  });

  return inserted.id;
}

async function loadRoundContext(roundId: string) {
  const { data: round, error: rErr } = await supabaseAdmin
    .from("rounds")
    .select("id, status, finished_at, created_at")
    .eq("id", roundId)
    .single();
  if (rErr) throw rErr;

  const rr = round as unknown as RoundRow;
  if (!isCompletedRound(rr)) return null;

  const occurred_at = occurredAtForRound(rr);

  // course snapshot (latest)
  const { data: cs, error: csErr } = await supabaseAdmin
    .from("round_course_snapshots")
    .select("id, source_course_id, course_name, created_at")
    .eq("round_id", roundId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (csErr) throw csErr;
  const courseSnap = (cs?.[0] ?? null) as any as CourseSnap | null;

  // tee snapshot (latest)  ✅ MUST SELECT ID
  let teeSnap: TeeSnap | null = null;
  if (courseSnap?.id) {
    const { data: ts, error: tsErr } = await supabaseAdmin
      .from("round_tee_snapshots")
      .select("id, name, created_at")
      .eq("round_course_snapshot_id", courseSnap.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (tsErr) throw tsErr;
    teeSnap = (ts?.[0] ?? null) as any as TeeSnap | null;
  }

  // participants
  const { data: parts, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select("id, profile_id, is_guest, display_name")
    .eq("round_id", roundId)
    .order("created_at", { ascending: true });
  if (pErr) throw pErr;

  const participants = (parts ?? []) as any as ParticipantRow[];
  const participantIds = participants.map((p) => p.id).filter(Boolean);

  // scores (strokes by hole)
  const scoreRows: ScoreRow[] = [];
  if (participantIds.length) {
    const { data: scores, error: sErr } = await supabaseAdmin
      .from("round_current_scores")
      .select("participant_id, hole_number, strokes")
      .eq("round_id", roundId)
      .in("participant_id", participantIds);
    if (sErr) throw sErr;

    for (const row of scores ?? []) {
      const pid = (row as any).participant_id as string;
      const hole = Number((row as any).hole_number);
      const strokes = (row as any).strokes;
      const n = typeof strokes === "number" ? strokes : Number(strokes);
      if (!pid || !Number.isFinite(hole)) continue;
      scoreRows.push({ participant_id: pid, hole_number: hole, strokes: Number.isFinite(n) ? n : null });
    }
  }

  // par by hole  ✅ FIX: join via round_tee_snapshot_id
  const parByHole = new Map<number, number>();
  if (teeSnap?.id) {
    const { data: holes, error: hErr } = await supabaseAdmin
      .from("round_hole_snapshots")
      .select("hole_number, par")
      .eq("round_tee_snapshot_id", teeSnap.id)
      .order("hole_number", { ascending: true });
    if (hErr) throw hErr;

    for (const row of (holes ?? []) as any as HoleSnapRow[]) {
      const hn = Number(row.hole_number);
      const par = row.par;
      if (!Number.isFinite(hn)) continue;
      if (typeof par === "number" && Number.isFinite(par)) parByHole.set(hn, par);
    }
  }

  // handicap results (course handicap used)
  const chByParticipant = new Map<string, number | null>();
  if (participantIds.length) {
    const { data: hrs, error: hrErr } = await supabaseAdmin
      .from("handicap_round_results")
      .select("participant_id, course_handicap_used")
      .eq("round_id", roundId)
      .in("participant_id", participantIds);
    if (hrErr) throw hrErr;

    for (const row of (hrs ?? []) as any as HandicapResultRow[]) {
      const pid = (row as any).participant_id as string;
      const chRaw = (row as any).course_handicap_used;
      const ch = typeof chRaw === "number" ? chRaw : Number(chRaw);
      if (!pid) continue;
      chByParticipant.set(pid, Number.isFinite(ch) ? ch : null);
    }
  }

  // gross totals per participant (true gross = sum strokes)
  const grossByParticipant = new Map<string, number>();
  for (const s of scoreRows) {
    if (!s.participant_id) continue;
    if (typeof s.strokes !== "number") continue;
    grossByParticipant.set(s.participant_id, (grossByParticipant.get(s.participant_id) ?? 0) + s.strokes);
  }

  // profiles for display
  const profileIds = Array.from(new Set(participants.map((p) => p.profile_id).filter(Boolean))) as string[];
  const profileById = new Map<string, { name: string | null; avatar_url: string | null }>();

  if (profileIds.length) {
    const { data: profs, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", profileIds);
    if (profErr) throw profErr;

    for (const p of profs ?? []) {
      profileById.set(p.id, { name: (p as any).name ?? null, avatar_url: (p as any).avatar_url ?? null });
    }
  }

  const players = participants.map((rp) => {
    const pid = rp.id;
    const profile_id = rp.profile_id;

    const prof = profile_id ? profileById.get(profile_id) : null;
    const name = (prof?.name && String(prof.name)) || (rp.display_name && String(rp.display_name)) || "Player";
    const avatar_url = prof?.avatar_url ?? null;

    const gross_total = grossByParticipant.has(pid) ? grossByParticipant.get(pid)! : null;
    const ch = chByParticipant.get(pid) ?? null;
    const net_total = typeof gross_total === "number" && typeof ch === "number" ? gross_total - ch : null;

    return { profile_id, name, avatar_url, gross_total, net_total };
  });

  const subjectProfileIds = players
    .map((p) => (typeof p.profile_id === "string" ? p.profile_id : null))
    .filter(Boolean) as string[];

  return {
    roundId,
    occurred_at,
    courseSnap,
    teeSnap,
    participants,
    players,
    subjectProfileIds,
    scoreRows,
    parByHole,
    grossByParticipant,
  };
}

function courseKey(course_id: string | null, course_name: string | null, tee_name: string | null) {
  const c = course_id ? `id:${course_id}` : `name:${course_name ?? "unknown"}`;
  return `${c}::tee:${tee_name ?? "unknown"}`;
}

type BestEntry = {
  profile_id: string;
  round_id: string;
  occurred_at: string;
  gross: number;
  course_id: string | null;
  course_name: string | null;
  tee_name: string | null;
};

async function main() {
  const onlyRoundIds = process.argv.slice(2).filter(Boolean);
  const filterToRoundIds = onlyRoundIds.length ? new Set(onlyRoundIds) : null;

  const rounds = await fetchAll<RoundRow>("rounds", "id, status, finished_at, created_at");

  const completedRoundIds = rounds
    .filter(isCompletedRound)
    .map((r) => r.id)
    .filter((id) => (filterToRoundIds ? filterToRoundIds.has(id) : true));

  console.log(`[backfill_feed] Completed rounds: ${completedRoundIds.length}`);

  const contexts: Awaited<ReturnType<typeof loadRoundContext>>[] = [];
  for (const rid of completedRoundIds) {
    const ctx = await loadRoundContext(rid);
    if (!ctx) continue;
    contexts.push(ctx);
  }

  // 1) round_played
  for (const ctx of contexts) {
    if (!ctx) continue;

    const actorProfileId = ctx.subjectProfileIds[0];
    if (!actorProfileId) continue; // guests-only

    const payload = parseFeedPayload("round_played", {
      round_id: ctx.roundId,
      course_id: ctx.courseSnap?.source_course_id ?? null,
      course_name: ctx.courseSnap?.course_name ?? "Course",
      tee_name: ctx.teeSnap?.name ?? null,
      players: ctx.players,
      date: ctx.occurred_at.slice(0, 10),
    });
    if (!payload) continue;

    await insertFeedItemIfMissing({
      type: "round_played",
      group_key: `round:${ctx.roundId}`,
      actor_profile_id: actorProfileId,
      occurred_at: ctx.occurred_at,
      payload,
      subjectProfileIds: ctx.subjectProfileIds,
      subjectRole: "player",
    });
  }

  // 2) hole_event
  for (const ctx of contexts) {
    if (!ctx) continue;

    const course_name = ctx.courseSnap?.course_name ?? "Course";
    const course_id = ctx.courseSnap?.source_course_id ?? null;
    const tee_name = ctx.teeSnap?.name ?? null;

    const participantProfile = new Map<string, string | null>();
    for (const p of ctx.participants) participantProfile.set(p.id, p.profile_id);

    for (const s of ctx.scoreRows) {
      const profile_id = participantProfile.get(s.participant_id) ?? null;
      if (!profile_id) continue;

      const strokes = s.strokes;
      const par = ctx.parByHole.get(s.hole_number);
      if (typeof strokes !== "number" || typeof par !== "number") continue;

      const kind = kindFromStrokesAndPar(strokes, par);
      if (!kind) continue;

      const payload = parseFeedPayload("hole_event", {
        round_id: ctx.roundId,
        course_id,
        course_name,
        tee_name,
        hole_number: s.hole_number,
        par,
        strokes,
        kind,
        date: ctx.occurred_at.slice(0, 10),
      });
      if (!payload) continue;

      const group_key = `hole_event:${ctx.roundId}:${profile_id}:h${s.hole_number}:${kind}`;

      await insertFeedItemIfMissing({
        type: "hole_event",
        group_key,
        actor_profile_id: profile_id,
        occurred_at: ctx.occurred_at,
        payload,
        subjectProfileIds: [profile_id],
        subjectRole: "player",
      });
    }
  }

  // 3) course_record + pb
  const bestCourseRecordByKey = new Map<string, BestEntry>();
  const bestPBByPlayerCourseKey = new Map<string, BestEntry>();
  const firstPlayByPlayerCourseKey = new Map<string, string>();

  for (const ctx of contexts) {
    if (!ctx) continue;

    const course_id = ctx.courseSnap?.source_course_id ?? null;
    const course_name = ctx.courseSnap?.course_name ?? null;
    const tee_name = ctx.teeSnap?.name ?? null;

    const participantProfile = new Map<string, string | null>();
    for (const p of ctx.participants) participantProfile.set(p.id, p.profile_id);

    for (const [participant_id, gross] of ctx.grossByParticipant.entries()) {
      const profile_id = participantProfile.get(participant_id) ?? null;
      if (!profile_id) continue;
      if (!Number.isFinite(gross)) continue;

      const ckey = courseKey(course_id, course_name, tee_name);
      const pbKey = `${profile_id}::${ckey}`;

      const prevFirst = firstPlayByPlayerCourseKey.get(pbKey);
      if (!prevFirst || ctx.occurred_at < prevFirst) firstPlayByPlayerCourseKey.set(pbKey, ctx.occurred_at);

      const entry: BestEntry = {
        profile_id,
        round_id: ctx.roundId,
        occurred_at: ctx.occurred_at,
        gross,
        course_id,
        course_name,
        tee_name,
      };

      const existingCR = bestCourseRecordByKey.get(ckey);
      if (!existingCR || entry.gross < existingCR.gross || (entry.gross === existingCR.gross && entry.occurred_at < existingCR.occurred_at)) {
        bestCourseRecordByKey.set(ckey, entry);
      }

      const existingPB = bestPBByPlayerCourseKey.get(pbKey);
      if (!existingPB || entry.gross < existingPB.gross || (entry.gross === existingPB.gross && entry.occurred_at < existingPB.occurred_at)) {
        bestPBByPlayerCourseKey.set(pbKey, entry);
      }
    }
  }

  const courseRecordRoundKeys = new Set<string>();

  for (const [ckey, best] of bestCourseRecordByKey.entries()) {
    const payload = parseFeedPayload("course_record", {
      record_type: "course_record",
      metric: "gross",
      score: best.gross,
      gross: best.gross,

      round_id: best.round_id,
      course_id: best.course_id,
      course_name: best.course_name ?? "Course",
      tee_name: best.tee_name ?? null,
      date: best.occurred_at.slice(0, 10),
    });
    if (!payload) continue;

    const group_key = `course_record:${ckey}`;
    const id = await insertFeedItemIfMissing({
      type: "course_record",
      group_key,
      actor_profile_id: best.profile_id,
      occurred_at: best.occurred_at,
      payload,
      subjectProfileIds: [best.profile_id],
      subjectRole: "player",
    });

    if (id) courseRecordRoundKeys.add(`${best.profile_id}::${ckey}::round:${best.round_id}`);
  }

  for (const [pbKey, best] of bestPBByPlayerCourseKey.entries()) {
    const ckey = courseKey(best.course_id, best.course_name, best.tee_name);

    const first = firstPlayByPlayerCourseKey.get(pbKey);
    if (!first) continue;
    if (best.occurred_at === first) continue;
    if (courseRecordRoundKeys.has(`${best.profile_id}::${ckey}::round:${best.round_id}`)) continue;

    const payload = parseFeedPayload("pb", {
      record_type: "pb",
      metric: "gross",
      score: best.gross,
      gross: best.gross,

      round_id: best.round_id,
      course_id: best.course_id,
      course_name: best.course_name ?? "Course",
      tee_name: best.tee_name ?? null,
      date: best.occurred_at.slice(0, 10),
    });
    if (!payload) continue;

    const group_key = `pb:${pbKey}`;
    await insertFeedItemIfMissing({
      type: "pb",
      group_key,
      actor_profile_id: best.profile_id,
      occurred_at: best.occurred_at,
      payload,
      subjectProfileIds: [best.profile_id],
      subjectRole: "player",
    });
  }

  console.log("[backfill_feed] Done.");
}

main().catch((e) => {
  console.error("[backfill_feed] Failed:", e);
  process.exit(1);
});

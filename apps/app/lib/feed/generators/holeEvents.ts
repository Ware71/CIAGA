/**
 * Emits hole_event feed items (Eagle, Albatross, Hole-in-One) for a completed round.
 *
 * Called at round finish. Detects qualifying scores and emits one feed item per event.
 * Idempotent via group_key per round+player+hole+kind.
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseFeedPayload } from "@/lib/feed/schemas";
import { fanOutFeedItemToSubjectsAndFollowers } from "@/lib/feed/fanout";

type HoleEventKind = "hio" | "albatross" | "eagle";

function kindFromStrokesAndPar(strokes: number, par: number): HoleEventKind | null {
  if (strokes === 1) return "hio";
  const diff = strokes - par;
  if (diff === -3) return "albatross";
  if (diff === -2) return "eagle";
  return null;
}

export async function emitHoleEventFeedItems(params: {
  roundId: string;
  actorProfileId: string;
}): Promise<Array<{ feed_item_id: string }>> {
  const { roundId, actorProfileId } = params;
  if (!roundId || !actorProfileId) return [];

  // Course snapshot
  const { data: snaps, error: sErr } = await supabaseAdmin
    .from("round_course_snapshots")
    .select("id, source_course_id, course_name, created_at")
    .eq("round_id", roundId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (sErr) throw sErr;
  const courseSnap = (snaps ?? [])[0] as any | undefined;

  // Tee snapshot
  let teeSnap: any = undefined;
  if (courseSnap?.id) {
    const { data: ts, error: tsErr } = await supabaseAdmin
      .from("round_tee_snapshots")
      .select("id, name, created_at")
      .eq("round_course_snapshot_id", courseSnap.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (tsErr) throw tsErr;
    teeSnap = (ts ?? [])[0] as any | undefined;
  }

  // Participants
  const { data: parts, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select("id, profile_id, display_name")
    .eq("round_id", roundId)
    .order("created_at", { ascending: true });
  if (pErr) throw pErr;

  const participants = parts ?? [];
  const participantIds = participants.map((p: any) => p.id).filter(Boolean);

  const participantProfileMap = new Map<string, string | null>();
  for (const p of participants as any[]) {
    participantProfileMap.set(p.id, p.profile_id ?? null);
  }

  // Scores
  const { data: scoreRows, error: scErr } = await supabaseAdmin
    .from("round_current_scores")
    .select("participant_id, hole_number, strokes")
    .eq("round_id", roundId)
    .in("participant_id", participantIds.length ? participantIds : ["00000000-0000-0000-0000-000000000000"]);
  if (scErr) throw scErr;

  // Hole snapshots (par + yardage)
  const parByHole = new Map<number, number>();
  const yardageByHole = new Map<number, number>();

  if (teeSnap?.id) {
    const { data: holeRows, error: hErr } = await supabaseAdmin
      .from("round_hole_snapshots")
      .select("hole_number, par, yardage")
      .eq("round_tee_snapshot_id", teeSnap.id);
    if (hErr) throw hErr;

    for (const h of (holeRows ?? []) as any[]) {
      if (typeof h.par === "number") parByHole.set(h.hole_number, h.par);
      if (typeof h.yardage === "number") yardageByHole.set(h.hole_number, h.yardage);
    }
  }

  // Round occurred_at for timestamp
  const { data: round } = await supabaseAdmin
    .from("rounds")
    .select("finished_at, created_at")
    .eq("id", roundId)
    .single();
  const occurred_at =
    (round as any)?.finished_at ?? (round as any)?.created_at ?? new Date().toISOString();

  const course_name = courseSnap?.course_name ?? "Course";
  const course_id = courseSnap?.source_course_id ?? null;
  const tee_name = teeSnap?.name ?? null;

  const results: Array<{ feed_item_id: string }> = [];

  for (const row of (scoreRows ?? []) as any[]) {
    const participantId = row.participant_id as string;
    const profile_id = participantProfileMap.get(participantId) ?? null;
    if (!profile_id) continue; // guests don't get feed items

    const strokes = typeof row.strokes === "number" ? row.strokes : null;
    const holeNumber = row.hole_number as number;
    const par = parByHole.get(holeNumber);
    if (strokes === null || par === undefined) continue;

    const kind = kindFromStrokesAndPar(strokes, par);
    if (!kind) continue;

    const group_key = `hole_event:${roundId}:${profile_id}:h${holeNumber}:${kind}`;

    // Idempotency check
    const { data: existing } = await supabaseAdmin
      .from("feed_items")
      .select("id")
      .eq("group_key", group_key)
      .maybeSingle();
    if (existing?.id) {
      results.push({ feed_item_id: existing.id });
      continue;
    }

    const payload = parseFeedPayload("hole_event", {
      round_id: roundId,
      course_id,
      course_name,
      tee_name,
      profile_id,
      hole_number: holeNumber,
      par,
      yardage: yardageByHole.get(holeNumber) ?? null,
      strokes,
      kind,
      date: typeof occurred_at === "string" ? occurred_at.slice(0, 10) : null,
    });
    if (!payload) continue;

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("feed_items")
      .insert({
        type: "hole_event",
        actor_profile_id: profile_id,
        audience: "followers",
        visibility: "visible",
        occurred_at,
        payload,
        group_key,
      })
      .select("id")
      .single();

    if (insErr) throw insErr;
    if (!inserted?.id) continue;

    // Subject index
    const { error: subjErr } = await supabaseAdmin
      .from("feed_item_subjects")
      .upsert(
        [{ feed_item_id: inserted.id, subject_profile_id: profile_id, role: "player" }],
        { onConflict: "feed_item_id,subject_profile_id" },
      );
    if (subjErr) throw subjErr;

    await fanOutFeedItemToSubjectsAndFollowers({
      feedItemId: inserted.id,
      actorProfileId: profile_id,
      audience: "followers",
      subjectProfileIds: [profile_id],
    });

    results.push({ feed_item_id: inserted.id });
  }

  return results;
}

/**
 * Emits PB (Personal Best) and Course Record feed items for a completed round.
 *
 * Eligibility:
 * - Only participants with a profile_id (not guests)
 * - ALL holes must be "completed" (no pickups, no not_started) — stricter than handicap acceptance
 * - Gross-only (not net)
 *
 * Course Record:
 * - Best gross across all users at a course+tee
 * - Based on who you follow: fan-out goes to the record holder + their followers
 * - group_key per course+tee — new records UPDATE the existing feed item
 *
 * Personal Best:
 * - Best gross for a player at a course+tee
 * - Skip if it's the player's first round at that course+tee
 * - Skip if the round is also a Course Record (CR takes precedence)
 * - group_key per player+course+tee — new PBs UPDATE the existing feed item
 */

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseFeedPayload } from "@/lib/feed/schemas";
import { fanOutFeedItemToSubjectsAndFollowers } from "@/lib/feed/fanout";

// ── Helpers ──────────────────────────────────────────────────────────

function courseKey(
  course_id: string | null,
  course_name: string | null,
  tee_name: string | null,
): string {
  const c = course_id ? `id:${course_id}` : `name:${course_name ?? "unknown"}`;
  return `${c}::tee:${tee_name ?? "unknown"}`;
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

/**
 * Insert a new feed item, or update an existing one if this score is better.
 * Returns the feed_item_id if created/updated, null if skipped.
 */
async function upsertIfBetterRecord(params: {
  type: "course_record" | "pb";
  group_key: string;
  actor_profile_id: string;
  occurred_at: string;
  payload: any;
  gross_total: number;
  subjectProfileIds: string[];
}): Promise<string | null> {
  const { type, group_key, actor_profile_id, occurred_at, payload, gross_total, subjectProfileIds } =
    params;

  // Check for existing feed item
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("feed_items")
    .select("id, payload")
    .eq("group_key", group_key)
    .maybeSingle();
  if (exErr) throw exErr;

  if (existing?.id) {
    // Compare: only update if this gross is strictly better
    const existingGross =
      (existing.payload as any)?.gross_total ??
      (existing.payload as any)?.gross ??
      (existing.payload as any)?.score;
    if (typeof existingGross === "number" && gross_total >= existingGross) {
      return null; // existing record is equal or better
    }

    // Update existing item
    const { error: upErr } = await supabaseAdmin
      .from("feed_items")
      .update({
        payload,
        occurred_at,
        actor_profile_id,
      })
      .eq("id", existing.id);
    if (upErr) throw upErr;

    // Re-index subjects and re-fan-out
    await upsertSubjects(existing.id, subjectProfileIds, "player");
    await fanOutFeedItemToSubjectsAndFollowers({
      feedItemId: existing.id,
      actorProfileId: actor_profile_id,
      audience: "followers",
      subjectProfileIds,
    });

    return existing.id;
  }

  // Insert new
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
  if (!inserted?.id) return null;

  await upsertSubjects(inserted.id, subjectProfileIds, "player");
  await fanOutFeedItemToSubjectsAndFollowers({
    feedItemId: inserted.id,
    actorProfileId: actor_profile_id,
    audience: "followers",
    subjectProfileIds,
  });

  return inserted.id;
}

// ── Main ─────────────────────────────────────────────────────────────

export async function emitAchievementFeedItems(params: {
  roundId: string;
  actorProfileId: string;
}): Promise<Array<{ feed_item_id: string }>> {
  const { roundId } = params;
  if (!roundId) return [];

  // 1. Course + tee snapshot
  const { data: snaps, error: sErr } = await supabaseAdmin
    .from("round_course_snapshots")
    .select("id, source_course_id, course_name, created_at")
    .eq("round_id", roundId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (sErr) throw sErr;
  const courseSnap = (snaps ?? [])[0] as any | undefined;

  let teeSnap: any = undefined;
  if (courseSnap?.id) {
    const { data: ts, error: tsErr } = await supabaseAdmin
      .from("round_tee_snapshots")
      .select("id, name, holes_count, created_at")
      .eq("round_course_snapshot_id", courseSnap.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (tsErr) throw tsErr;
    teeSnap = (ts ?? [])[0] as any | undefined;
  }

  const course_id = courseSnap?.source_course_id ?? null;
  const course_name = courseSnap?.course_name ?? "Course";
  const tee_name = teeSnap?.name ?? null;
  const holesCount: number | null = teeSnap?.holes_count ?? null;

  // 2. Participants
  const { data: parts, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select("id, profile_id, display_name")
    .eq("round_id", roundId)
    .order("created_at", { ascending: true });
  if (pErr) throw pErr;

  const participants = (parts ?? []) as any[];
  const participantIds = participants.map((p) => p.id).filter(Boolean);

  // 3. Hole states — check eligibility per participant
  const { data: stateRows, error: hsErr } = await supabaseAdmin
    .from("round_hole_states")
    .select("participant_id, hole_number, status")
    .eq("round_id", roundId)
    .in("participant_id", participantIds.length ? participantIds : ["00000000-0000-0000-0000-000000000000"]);
  if (hsErr) throw hsErr;

  // Build: participantId → { total holes, completed count }
  const holeStates = new Map<string, { total: number; completed: number }>();
  for (const hs of (stateRows ?? []) as any[]) {
    const pid = hs.participant_id as string;
    const entry = holeStates.get(pid) ?? { total: 0, completed: 0 };
    entry.total++;
    if (hs.status === "completed") entry.completed++;
    holeStates.set(pid, entry);
  }

  // Eligible: all holes completed (no pickups, no not_started), must match expected hole count
  const eligibleParticipantIds = new Set<string>();
  for (const [pid, state] of holeStates) {
    const expectedHoles = holesCount ?? state.total; // fallback to total if holesCount unknown
    if (state.completed === expectedHoles && state.completed > 0) {
      eligibleParticipantIds.add(pid);
    }
  }

  // 4. Gross totals for eligible participants
  const { data: scoreRows, error: scErr } = await supabaseAdmin
    .from("round_current_scores")
    .select("participant_id, strokes")
    .eq("round_id", roundId)
    .in("participant_id", participantIds);
  if (scErr) throw scErr;

  const grossByParticipant = new Map<string, number>();
  for (const s of (scoreRows ?? []) as any[]) {
    const pid = s.participant_id as string;
    const strokes = typeof s.strokes === "number" ? s.strokes : null;
    if (!pid || strokes === null) continue;
    grossByParticipant.set(pid, (grossByParticipant.get(pid) ?? 0) + strokes);
  }

  // Round occurred_at
  const { data: round } = await supabaseAdmin
    .from("rounds")
    .select("finished_at, created_at")
    .eq("id", roundId)
    .single();
  const occurred_at =
    (round as any)?.finished_at ?? (round as any)?.created_at ?? new Date().toISOString();

  // Profiles for display
  const profileIds = Array.from(
    new Set(participants.map((p: any) => p.profile_id).filter(Boolean)),
  ) as string[];

  const profileById = new Map<string, { name: string; avatar_url: string | null }>();
  if (profileIds.length) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", profileIds);
    for (const p of (profs ?? []) as any[]) {
      profileById.set(p.id, { name: p.name ?? "Player", avatar_url: p.avatar_url ?? null });
    }
  }

  // 5. Historical data: best gross per course+tee from v_course_record_rounds
  // We need: (a) best gross across ALL users (for CR), (b) best gross per player (for PB)
  const ckey = courseKey(course_id, course_name, tee_name);

  // Query previous complete rounds at same course for CR comparison
  let bestGrossAllUsers: number | null = null;
  let bestGrossByProfile = new Map<string, { gross: number; round_count: number }>();

  // Use the view to get historical data — filter by course_id or course_name+tee_name
  const viewFilter = course_id
    ? { column: "course_id", value: course_id }
    : null;

  if (viewFilter) {
    const { data: crRows } = await supabaseAdmin
      .from("v_course_record_rounds")
      .select("profile_id, gross_score, is_complete, round_id, tee_name")
      .eq(viewFilter.column, viewFilter.value)
      .eq("is_complete", true);

    for (const row of (crRows ?? []) as any[]) {
      // Filter to matching tee_name
      if ((row.tee_name ?? null) !== tee_name) continue;
      // Exclude current round from historical comparison
      if (row.round_id === roundId) continue;

      const gross = typeof row.gross_score === "number" ? row.gross_score : null;
      const pid = row.profile_id as string | null;
      if (gross === null) continue;

      // Track overall best
      if (bestGrossAllUsers === null || gross < bestGrossAllUsers) {
        bestGrossAllUsers = gross;
      }

      // Track per-player best + count
      if (pid) {
        const existing = bestGrossByProfile.get(pid);
        if (!existing) {
          bestGrossByProfile.set(pid, { gross, round_count: 1 });
        } else {
          existing.round_count++;
          if (gross < existing.gross) existing.gross = gross;
        }
      }
    }
  }

  // 6. Emit CR and PB for each eligible participant
  const results: Array<{ feed_item_id: string }> = [];
  const crEmittedForRound = new Set<string>(); // track which participants got a CR

  for (const rp of participants) {
    const participantId = rp.id as string;
    const profile_id = rp.profile_id as string | null;
    if (!profile_id) continue; // guests skip
    if (!eligibleParticipantIds.has(participantId)) continue; // not all holes completed

    const gross = grossByParticipant.get(participantId);
    if (typeof gross !== "number") continue;

    const prof = profileById.get(profile_id);
    const playerName = prof?.name ?? rp.display_name ?? "Player";
    const avatar_url = prof?.avatar_url ?? null;

    // Course Record check
    const isCR =
      bestGrossAllUsers === null || // no previous rounds at this course+tee
      gross < bestGrossAllUsers;

    if (isCR) {
      const crGroupKey = `course_record:${ckey}`;
      const crPayload = parseFeedPayload("course_record", {
        round_id: roundId,
        course_id,
        course_name,
        tee_name,
        profile_id,
        name: playerName,
        avatar_url,
        gross_total: gross,
        date: occurred_at.slice(0, 10),
      });

      if (crPayload) {
        const id = await upsertIfBetterRecord({
          type: "course_record",
          group_key: crGroupKey,
          actor_profile_id: profile_id,
          occurred_at,
          payload: crPayload,
          gross_total: gross,
          subjectProfileIds: [profile_id],
        });
        if (id) {
          results.push({ feed_item_id: id });
          crEmittedForRound.add(profile_id);
        }
      }
    }

    // PB check — skip if already emitted as CR
    if (crEmittedForRound.has(profile_id)) continue;

    const playerHistory = bestGrossByProfile.get(profile_id);
    // Skip if first round at this course+tee (no history)
    if (!playerHistory) continue;
    // Skip if not better than previous best
    if (gross >= playerHistory.gross) continue;

    const pbGroupKey = `pb:${profile_id}::${ckey}`;
    const pbPayload = parseFeedPayload("pb", {
      round_id: roundId,
      course_id,
      course_name,
      tee_name,
      profile_id,
      name: playerName,
      avatar_url,
      gross_total: gross,
      date: occurred_at.slice(0, 10),
    });

    if (pbPayload) {
      const id = await upsertIfBetterRecord({
        type: "pb",
        group_key: pbGroupKey,
        actor_profile_id: profile_id,
        occurred_at,
        payload: pbPayload,
        gross_total: gross,
        subjectProfileIds: [profile_id],
      });
      if (id) {
        results.push({ feed_item_id: id });
      }
    }
  }

  return results;
}

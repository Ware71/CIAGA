// lib/feed/generators/roundPlayed.ts
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parseFeedPayload } from "@/lib/feed/schemas";
import { fanOutFeedItemToSubjectsAndFollowers } from "@/lib/feed/fanout";
import { computeFormatSummaryForFeed } from "@/lib/feed/helpers/formatSummary";

/**
 * Emits a round_played feed item for a completed round.
 *
 * Spec notes:
 * - Header/cards are about the PLAYERS (subjects), not the creator.
 * - Fan-out targets = subjects + followers of subjects (+ actor if needed).
 * - Payload must include per-player gross/net totals.
 * - Idempotent by group_key.
 *
 * IMPORTANT FIX:
 * - Gross must be TRUE gross strokes, not Adjusted Gross Score (AGS).
 * - We now compute gross_total as SUM(round_current_scores.strokes) per participant.
 * - We still use handicap_round_results.course_handicap_used for net_total.
 */

export async function emitRoundPlayedFeedItem(params: {
  roundId: string;
  actorProfileId: string;
}): Promise<{ feed_item_id: string } | null> {
  const { roundId, actorProfileId } = params;
  if (!roundId || !actorProfileId) throw new Error("Missing roundId/actorProfileId");

  // Round lookup
  const { data: round, error: roundErr } = await supabaseAdmin
    .from("rounds")
    .select("id, status, finished_at")
    .eq("id", roundId)
    .single();

  if (roundErr) throw roundErr;
  if (!round) throw new Error("Round not found");

  const status = String((round as any).status ?? "").toLowerCase();
  if (status === "live") return null;

  // Idempotency
  const group_key = `round:${roundId}`;
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("feed_items")
    .select("id")
    .eq("group_key", group_key)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing?.id) return { feed_item_id: existing.id };

  // Course + tee snapshot
  const { data: snaps, error: sErr } = await supabaseAdmin
    .from("round_course_snapshots")
    .select("id, source_course_id, course_name, created_at")
    .eq("round_id", roundId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (sErr) throw sErr;
  const courseSnap = (snaps ?? [])[0] as any | undefined;

  const { data: teeSnaps, error: tsErr } = await supabaseAdmin
    .from("round_tee_snapshots")
    .select("name, created_at")
    .eq("round_course_snapshot_id", courseSnap?.id ?? "00000000-0000-0000-0000-000000000000")
    .order("created_at", { ascending: false })
    .limit(1);
  if (tsErr) throw tsErr;
  const teeSnap = (teeSnaps ?? [])[0] as any | undefined;

  const occurred_at =
    (round as any).finished_at ??
    (round as any).completed_at ??
    (round as any).updated_at ??
    (round as any).created_at ??
    new Date().toISOString();

  // Participants (profiles + guests)
  const { data: participants, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select("id, profile_id, is_guest, display_name")
    .eq("round_id", roundId)
    .order("created_at", { ascending: true });
  if (pErr) throw pErr;

  const participantIds = (participants ?? []).map((r: any) => r.id).filter(Boolean);
  const profileIds = Array.from(new Set((participants ?? []).map((r: any) => r.profile_id as string).filter(Boolean)));

  // --- FIX: TRUE gross strokes from round_current_scores ----------------------
  // We compute gross_total = SUM(strokes) for each participant in this round.
  const grossByParticipantId = new Map<string, number>();

  if (participantIds.length) {
    const { data: scores, error: scErr } = await supabaseAdmin
      .from("round_current_scores")
      .select("participant_id, strokes")
      .eq("round_id", roundId)
      .in("participant_id", participantIds);
    if (scErr) throw scErr;

    for (const row of scores ?? []) {
      const pid = (row as any).participant_id as string;
      const strokes = (row as any).strokes;
      const n = typeof strokes === "number" ? strokes : Number(strokes);
      if (!pid || !Number.isFinite(n)) continue;
      grossByParticipantId.set(pid, (grossByParticipantId.get(pid) ?? 0) + n);
    }
  }

  // Handicap results per participant (use ONLY course handicap used; do NOT use AGS)
  const { data: results, error: rErr } = await supabaseAdmin
    .from("handicap_round_results")
    .select("participant_id, course_handicap_used")
    .eq("round_id", roundId)
    .in("participant_id", participantIds.length ? participantIds : ["00000000-0000-0000-0000-000000000000"]);
  if (rErr) throw rErr;

  const courseHandicapByParticipantId = new Map<string, number | null>();
  for (const row of results ?? []) {
    const pid = (row as any).participant_id as string;
    if (!pid) continue;
    const chRaw = (row as any).course_handicap_used;
    const ch = typeof chRaw === "number" ? chRaw : Number(chRaw);
    courseHandicapByParticipantId.set(pid, Number.isFinite(ch) ? ch : null);
  }

  // Profile embeds
  const { data: profs, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id, name, avatar_url")
    .in("id", profileIds.length ? profileIds : [actorProfileId]);
  if (profErr) throw profErr;

  const profileById = new Map<string, { name: string; avatar_url: string | null }>();
  for (const p of profs ?? []) {
    profileById.set(p.id, {
      name: (p as any).name ?? "Player",
      avatar_url: (p as any).avatar_url ?? null,
    });
  }

  // Format scoring (best-effort — null if unavailable)
  let formatSummary: Awaited<ReturnType<typeof computeFormatSummaryForFeed>> = null;
  try {
    formatSummary = await computeFormatSummaryForFeed(roundId);
  } catch {
    // Non-fatal: proceed without format data
  }

  // Build players[] payload
  const players = (participants ?? []).map((rp: any) => {
    const pid = rp.id as string;
    const profile_id = (rp.profile_id as string | null) ?? null;

    const prof = profile_id ? profileById.get(profile_id) : null;
    const name =
      (typeof prof?.name === "string" && prof.name) ||
      (typeof rp.display_name === "string" && rp.display_name) ||
      "Player";

    const avatar_url = prof?.avatar_url ?? null;

    // TRUE gross
    const gross_total = grossByParticipantId.has(pid) ? grossByParticipantId.get(pid)! : null;

    // Net = gross - course handicap used (if we have both)
    const ch = courseHandicapByParticipantId.get(pid) ?? null;
    const net_total = typeof gross_total === "number" && typeof ch === "number" ? gross_total - ch : null;

    const format_score = formatSummary?.player_scores.get(pid) ?? null;

    return {
      profile_id,
      name,
      avatar_url,
      gross_total,
      net_total,
      format_score,
    };
  });

  const subjectProfileIds = players
    .map((p: any) => (typeof p.profile_id === "string" ? p.profile_id : null))
    .filter(Boolean) as string[];

  const payload = parseFeedPayload("round_played", {
    round_id: roundId,
    course_id: courseSnap?.source_course_id ?? null,
    course_name: courseSnap?.course_name ?? "Course",
    tee_name: teeSnap?.name ?? null,
    format_type: formatSummary?.format_type ?? null,
    format_label: formatSummary?.format_label ?? null,
    format_winner: formatSummary?.format_winner ?? null,
    side_game_results: formatSummary?.side_game_results ?? null,
    players,
    date: typeof occurred_at === "string" ? occurred_at.slice(0, 10) : null,
  });

  if (!payload) {
    // Don’t emit malformed items.
    return null;
  }

  // Insert feed item
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("feed_items")
    .insert({
      type: "round_played",
      actor_profile_id: actorProfileId,
      audience: "followers",
      visibility: "visible",
      occurred_at,
      payload,
      group_key,
    })
    .select("id")
    .single();

  if (insErr) throw insErr;
  if (!inserted?.id) throw new Error("Failed to insert feed item");

  // Subject index (for profile -> social tab)
  if (subjectProfileIds.length) {
    const rows = Array.from(new Set(subjectProfileIds)).map((sid) => ({
      feed_item_id: inserted.id,
      subject_profile_id: sid,
      role: "player",
    }));

    const { error: subjErr } = await supabaseAdmin
      .from("feed_item_subjects")
      .upsert(rows, { onConflict: "feed_item_id,subject_profile_id" });

    if (subjErr) throw subjErr;
  }

  // Fan-out targets
  await fanOutFeedItemToSubjectsAndFollowers({
    feedItemId: inserted.id,
    actorProfileId,
    audience: "followers",
    subjectProfileIds,
  });

  return { feed_item_id: inserted.id };
}

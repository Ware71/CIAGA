import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fanOutFeedItemToFollowers } from "@/lib/feed/fanout";

export async function emitRoundPlayedFeedItem(params: {
  roundId: string;
  actorProfileId: string;
}): Promise<{ feed_item_id: string } | null> {
  const { roundId, actorProfileId } = params;
  if (!roundId || !actorProfileId) throw new Error("Missing roundId/actorProfileId");

  const { data: round, error: roundErr } = await supabaseAdmin
    .from("rounds")
    .select("*")
    .eq("id", roundId)
    .single();

  if (roundErr) throw roundErr;
  if (!round) throw new Error("Round not found");

  const status = String((round as any).status ?? "");
  if (status.toLowerCase() === "live") return null;

  const { data: participants, error: pErr } = await supabaseAdmin
    .from("round_participants")
    .select("profile_id")
    .eq("round_id", roundId);

  if (pErr) throw pErr;

  const participantProfileIds = Array.from(
    new Set((participants ?? []).map((r: any) => r.profile_id as string).filter(Boolean))
  );

  const { data: profs, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id, name")
    .in("id", participantProfileIds.length ? participantProfileIds : [actorProfileId]);

  if (profErr) throw profErr;

  const nameById = new Map<string, string>();
  for (const p of profs ?? []) nameById.set(p.id, (p as any).name ?? "Player");

  const players = (participantProfileIds.length ? participantProfileIds : [actorProfileId]).map((pid) => ({
    profile_id: pid,
    name: nameById.get(pid) ?? "Player",
  }));

  const { data: snaps, error: sErr } = await supabaseAdmin
    .from("round_course_snapshots")
    .select("course_id, course_name, tee_name, created_at")
    .eq("round_id", roundId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (sErr) throw sErr;
  const snap = (snaps ?? [])[0] as any | undefined;

  const occurred_at =
    (round as any).ended_at ??
    (round as any).completed_at ??
    (round as any).updated_at ??
    (round as any).created_at ??
    new Date().toISOString();

  const group_key = `round_played:${roundId}`;

  const payload = {
    round_id: roundId,
    course_id: snap?.course_id ?? null,
    course_name: snap?.course_name ?? "",
    tee_name: snap?.tee_name ?? null,
    players,
    gross_total: typeof (round as any).gross_total === "number" ? (round as any).gross_total : null,
    net_total: typeof (round as any).net_total === "number" ? (round as any).net_total : null,
    date: typeof occurred_at === "string" ? occurred_at.slice(0, 10) : null,
  };

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

  await fanOutFeedItemToFollowers({
    feedItemId: inserted.id,
    actorProfileId,
    audience: "followers",
  });

  return { feed_item_id: inserted.id };
}

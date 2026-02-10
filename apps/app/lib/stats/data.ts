// src/lib/stats/data.ts

import { supabase } from "@/lib/supabaseClient";
import type { HiPoint } from "@/lib/stats/timeModel";

export type HiRow = { as_of_date: string; handicap_index: number };
export type FollowProfile = { id: string; name: string | null; avatar_url: string | null };

export async function getHandicapHistoryPoints(profileId: string): Promise<HiPoint[]> {
  const { data, error } = await supabase
    .from("handicap_index_history")
    .select("as_of_date, handicap_index")
    .eq("profile_id", profileId)
    .not("handicap_index", "is", null)
    .order("as_of_date", { ascending: true });

  if (error) throw error;

  return ((data as any as HiRow[]) ?? [])
    .filter((r) => typeof r.handicap_index === "number")
    .map((r) => ({ date: String(r.as_of_date), hi: Number(r.handicap_index) }));
}

export async function getFollowedProfiles(myProfileId: string): Promise<FollowProfile[]> {
  const { data: follows, error: followsErr } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", myProfileId);

  if (followsErr) throw followsErr;

  const followingIds = (follows ?? []).map((r: any) => r.following_id as string).filter(Boolean);
  if (!followingIds.length) return [];

  // ✅ Use public-safe resolver (must exist in DB as an RPC)
  const { data: profs, error: profErr } = await supabase.rpc("get_profiles_public", { ids: followingIds });

  if (profErr) throw profErr;

  const out = ((profs ?? []) as FollowProfile[]).slice();
  out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return out;
}

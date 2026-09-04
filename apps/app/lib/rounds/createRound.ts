import { supabase } from "@/lib/supabaseClient";
import { getWhsDefaultPolicy } from "@/lib/rounds/whsDefaults";

/**
 * Create an empty round and return its id.
 *
 * Lifted out of the /play hub so the nav's long-press wheel can offer the same
 * "New round" without a second copy of the payload drifting from the first. The
 * round is deliberately created with no course or tee — setup is where those are
 * chosen — but it is seeded with the WHS default allowance for strokeplay so a
 * round started without touching the format still scores correctly.
 *
 * Throws on failure; callers own the error surface, which differs a lot between
 * a page that can show a message and a wheel that is about to unmount.
 */
export async function createRound(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated");

  const policy = getWhsDefaultPolicy("strokeplay");

  const res = await fetch("/api/rounds/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      course_id: null,
      pending_tee_box_id: null,
      format_type: "strokeplay",
      default_playing_handicap_mode: policy.mode,
      default_playing_handicap_value: policy.allowance_pct,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Failed to create round");
  if (!json?.round_id) throw new Error("Round created without an id");

  return json.round_id as string;
}

/** Where a freshly created round should land. `new=1` flags it to the wizard. */
export function newRoundSetupHref(roundId: string): string {
  return `/round/${roundId}/setup?new=1`;
}

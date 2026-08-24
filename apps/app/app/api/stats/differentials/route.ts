import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * WHS score differentials for the projection engine.
 *
 * GET /api/stats/differentials?profileIds=<uuid>,<uuid>,…
 *   → { streams: { [profileId]: { d: "YYYY-MM-DD"; v: number }[] } }  (oldest first)
 *
 * Why a route handler rather than a direct client read: the differential stream
 * lives in the `ciaga_scoring_record_stream` view, which pairs and reduces
 * 9-hole rounds to 18-hole-equivalent differentials via `ciaga_played9_sd`. The
 * view has no grant to `authenticated`, and reimplementing its 9-hole logic in
 * the browser would mean two implementations of one WHS rule that can silently
 * diverge — exactly the class of bug the projection rework exists to remove.
 *
 * Authorisation is deliberately NARROWER than the underlying table policies
 * (`handicap_round_results` is readable by any authenticated user): a caller may
 * only pull their own stream and those of profiles they actually follow, and the
 * follow set is re-checked here rather than trusted from the query string.
 */

export const runtime = "nodejs";

/** PostgREST truncates at 1000 rows and drops the OLDEST — always page. */
const PAGE = 1000;
/** Compare-all across a follow list; beyond this someone is scraping. */
const MAX_PROFILES = 30;

export type DiffPoint = { d: string; v: number };

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const url = new URL(req.url);
    const requested = (url.searchParams.get("profileIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const unique = [...new Set(requested.length ? requested : [profileId])];
    if (unique.length > MAX_PROFILES) {
      return NextResponse.json(
        { error: `Too many profiles requested (max ${MAX_PROFILES})` },
        { status: 400 }
      );
    }

    // Re-derive what the caller is allowed to see. Anything else is dropped
    // silently rather than 403'd, so the response shape does not leak whether a
    // given profile id exists.
    const { data: follows, error: followsErr } = await supabaseAdmin
      .from("follows")
      .select("following_id")
      .eq("follower_id", profileId);
    if (followsErr) throw followsErr;

    const allowed = new Set<string>([profileId]);
    for (const f of (follows ?? []) as { following_id: string }[]) allowed.add(f.following_id);

    const ids = unique.filter((id) => allowed.has(id));
    const streams: Record<string, DiffPoint[]> = {};
    for (const id of ids) streams[id] = [];

    if (ids.length) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from("ciaga_scoring_record_stream")
          .select("profile_id, played_at, differential")
          .in("profile_id", ids)
          .not("differential", "is", null)
          .order("played_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;

        const chunk = (data ?? []) as {
          profile_id: string;
          played_at: string;
          differential: number | string;
        }[];

        for (const r of chunk) {
          const v = Number(r.differential);
          if (!Number.isFinite(v)) continue;
          streams[r.profile_id]?.push({ d: String(r.played_at).slice(0, 10), v });
        }

        if (chunk.length < PAGE) break;
      }
    }

    return NextResponse.json(
      { streams },
      // Private: these are per-viewer authorised sets, never shared caches.
      { headers: { "Cache-Control": "private, max-age=120" } }
    );
  } catch (e: any) {
    const msg = String(e?.message ?? "Unknown error");
    // getAuthedProfileOrThrow throws "Missing bearer token" for an absent header
    // and "Unauthorized" for a bad one — neither contains the substring "auth",
    // so matching on that alone reports a signed-out caller as a server error.
    const status = /missing bearer token|unauthori[sz]ed|no profile|auth/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCaller } from "@/lib/server/auth";

/**
 * Self-service data export (UK GDPR right of access + portability).
 * Returns a machine-readable JSON bundle of the caller's personal data.
 *
 * Each section is best-effort: if a table/column doesn't match, we record the
 * error for that section rather than failing the whole export.
 */
export async function GET(req: Request) {
  try {
    const auth = await getCaller(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { profileId, authUserId, email } = auth.caller;

    const sections: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    const collect = async (
      key: string,
      apply: (q: any) => any
    ): Promise<void> => {
      const { data, error } = await apply(supabaseAdmin.from(tableFor(key)).select("*"));
      if (error) errors[key] = error.message;
      else sections[key] = data ?? [];
    };

    // Profile (single row)
    {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .maybeSingle();
      if (error) errors.profile = error.message;
      else sections.profile = data ?? null;
    }

    await collect("rounds", (q) => q.eq("profile_id", profileId)); // round_participants
    await collect("handicap_history", (q) => q.eq("profile_id", profileId));
    await collect("calendar_events", (q) => q.eq("profile_id", profileId));
    await collect("feed_posts", (q) => q.eq("actor_profile_id", profileId));
    await collect("feed_comments", (q) => q.eq("profile_id", profileId));
    await collect("feed_reactions", (q) => q.eq("profile_id", profileId));
    await collect("fantasy_transactions", (q) => q.eq("profile_id", profileId));
    await collect("fantasy_picks", (q) => q.eq("profile_id", profileId));
    await collect("group_ledger", (q) => q.eq("profile_id", profileId));
    await collect("prize_pot_entries", (q) => q.eq("profile_id", profileId));
    await collect("invites_created", (q) => q.eq("created_by", profileId));

    // Follows (both directions)
    {
      const [followingRes, followerRes] = await Promise.all([
        supabaseAdmin.from("follows").select("*").eq("follower_id", profileId),
        supabaseAdmin.from("follows").select("*").eq("following_id", profileId),
      ]);
      if (followingRes.error || followerRes.error) {
        errors.follows = (followingRes.error || followerRes.error)!.message;
      } else {
        sections.follows = {
          following: followingRes.data ?? [],
          followers: followerRes.data ?? [],
        };
      }
    }

    // Push subscriptions — metadata only, redact the crypto keys.
    {
      const { data, error } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id, endpoint, user_agent, created_at, last_seen_at")
        .eq("profile_id", profileId);
      if (error) errors.push_subscriptions = error.message;
      else sections.push_subscriptions = data ?? [];
    }

    const bundle = {
      export_generated_at: new Date().toISOString(),
      subject: { auth_user_id: authUserId, profile_id: profileId, email },
      note: "This is a copy of the personal data held about you in CIAGA. Some records are shared with other members (e.g. rounds, standings, ledger entries).",
      data: sections,
      ...(Object.keys(errors).length ? { export_warnings: errors } : {}),
    };

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="ciaga-data-export-${profileId.slice(0, 8)}.json"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/** Maps an export section key to its underlying table name. */
function tableFor(key: string): string {
  const map: Record<string, string> = {
    rounds: "round_participants",
    handicap_history: "handicap_index_history",
    calendar_events: "calendar_events",
    feed_posts: "feed_items",
    feed_comments: "feed_comments",
    feed_reactions: "feed_reactions",
    fantasy_transactions: "fantasy_wallet_transactions",
    fantasy_picks: "fantasy_picks",
    group_ledger: "group_balance_transactions",
    prize_pot_entries: "prize_pot_entries",
    invites_created: "invites",
  };
  return map[key] ?? key;
}

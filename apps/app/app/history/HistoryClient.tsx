// /app/history/HistoryClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type ProfileRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

type HandicapHistoryRow = { as_of_date: string; handicap_index: number };

type RoundRow = {
  id: string;
  name: string | null;
  status: "draft" | "scheduled" | "starting" | "live" | "finished" | string;
  started_at: string | null;
  created_at: string | null;
  course_id: string | null;
  courses?: { name: string | null }[] | { name: string | null } | null;
};

type TeeSnap = { id: string; name: string | null };

type ParticipantRow = {
  id: string; // ✅ participant_id (round_participants.id) -> matches round_current_scores.participant_id
  round_id: string;
  tee_snapshot_id: string | null;
  rounds?: RoundRow[] | RoundRow | null;
};

// normalize join payloads
function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function isFinishedStatus(s: string | null | undefined) {
  const v = (s ?? "").toLowerCase();
  return v === "finished" || v === "completed" || v === "ended";
}

function parseDateMs(iso: string | null) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function monthKey(iso: string | null) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNumberMaybe(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ✅ WHS "used differentials" count table (same as player page)
function usedDifferentialsCount(n: number) {
  if (n <= 0) return 0;
  if (n <= 2) return 0; // need 3+ to produce an index
  if (n <= 5) return 1; // 3–5 -> 1
  if (n <= 8) return 2; // 6–8 -> 2
  if (n <= 11) return 3; // 9–11 -> 3
  if (n <= 14) return 4; // 12–14 -> 4
  if (n <= 16) return 5; // 15–16 -> 5
  if (n <= 18) return 6; // 17–18 -> 6
  if (n === 19) return 7; // 19 -> 7
  return 8; // 20 -> 8
}

export default function RoundsHistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ✅ public: /history?profile=<uuid>
  const profileFromQuery = (searchParams.get("profile") || "").trim() || null;

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileRow, setProfileRow] = useState<ProfileRow | null>(null);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [participantIdByRoundId, setParticipantIdByRoundId] = useState<Record<string, string>>({});
  const [teeNameByRoundId, setTeeNameByRoundId] = useState<Record<string, string>>({});
  const [myTotalByRoundId, setMyTotalByRoundId] = useState<Record<string, number>>({});

  // handicap extras (for display)
  const [agsByRoundId, setAgsByRoundId] = useState<Record<string, number>>({});
  const [scoreDiffByRoundId, setScoreDiffByRoundId] = useState<Record<string, number>>({});
  const [hiUsedByRoundId, setHiUsedByRoundId] = useState<Record<string, number>>({});
  const [hiAfterByRoundId, setHiAfterByRoundId] = useState<Record<string, number>>({});

  const [error, setError] = useState<string | null>(null);

  // Public-safe profile fetcher for the header title
  const fetchProfilePublic = async (id: string) => {
    const { data, error: e } = await supabase.rpc("get_profiles_public", { ids: [id] });
    if (e) throw e;
    const rows = ((data as any) ?? []) as ProfileRow[];
    return rows[0] ?? null;
  };

  useEffect(() => {
    let cancelled = false;

    async function resolveProfileId(): Promise<string | null> {
      // If query param exists, use it (public history view)
      if (profileFromQuery) return profileFromQuery;

      // Otherwise: fall back to signed-in user profile
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) return null;

      const pid = await getMyProfileIdByAuthUserId(authData.user.id);
      return pid ?? null;
    }

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const pid = await resolveProfileId();

        if (!pid) {
          // If no query param and not signed in
          if (!profileFromQuery) {
            setError("You must be signed in to view your round history.");
          } else {
            setError("Could not load this player's history.");
          }
          setLoading(false);
          return;
        }

        if (!cancelled) setProfileId(pid);

        // Header profile row (public-safe)
        try {
          const p = await fetchProfilePublic(pid);
          if (!cancelled) setProfileRow(p);
        } catch (e) {
          // non-fatal
          if (!cancelled) setProfileRow(null);
        }

        // 1) Load participant rows + round info
        const { data, error: qErr } = await supabase
          .from("round_participants")
          .select(
            `
              id,
              round_id,
              tee_snapshot_id,
              rounds:rounds!round_id (
                id,
                name,
                status,
                started_at,
                created_at,
                course_id,
                courses:courses ( name )
              )
            `
          )
          .eq("profile_id", pid);

        if (qErr) throw qErr;

        const rows = (data ?? []) as ParticipantRow[];

        // extract rounds, finished only
        const extractedAll: RoundRow[] = rows.map((r) => one(r.rounds)).filter(Boolean) as RoundRow[];
        const extracted = extractedAll.filter((r) => isFinishedStatus(r.status));

        // map roundId -> participantId + roundId -> tee_snapshot_id
        const pidMap: Record<string, string> = {};
        const teeSnapIdByRound: Record<string, string> = {};

        for (const pr of rows) {
          const round = one(pr.rounds);
          if (!round) continue;
          if (!isFinishedStatus(round.status)) continue;

          pidMap[round.id] = pr.id;
          if (pr.tee_snapshot_id) teeSnapIdByRound[round.id] = pr.tee_snapshot_id;
        }

        // sort newest first
        extracted.sort((a, b) => {
          const ad = parseDateMs(a.started_at ?? a.created_at);
          const bd = parseDateMs(b.started_at ?? b.created_at);
          return bd - ad;
        });

        if (cancelled) return;

        setRounds(extracted);
        setParticipantIdByRoundId(pidMap);

        // 2) Tee names in second query
        const teeIds = Array.from(new Set(Object.values(teeSnapIdByRound).filter(Boolean)));
        const teeNameMap: Record<string, string> = {};

        if (teeIds.length) {
          const teeSnaps: TeeSnap[] = [];
          for (const ids of chunk(teeIds, 150)) {
            const { data: tees, error: tErr } = await supabase.from("round_tee_snapshots").select("id,name").in("id", ids);
            if (tErr) continue;
            teeSnaps.push(...((tees ?? []) as TeeSnap[]));
          }

          const byId: Record<string, string> = {};
          for (const t of teeSnaps) byId[t.id] = t.name?.trim() || "—";

          for (const roundId of Object.keys(teeSnapIdByRound)) {
            const tid = teeSnapIdByRound[roundId];
            teeNameMap[roundId] = byId[tid] ?? "—";
          }
        }

        if (!cancelled) setTeeNameByRoundId(teeNameMap);

        // 3) Totals: fetch by (round_id, participant_id)
        const participantIds = Array.from(new Set(Object.values(pidMap).filter(Boolean)));
        const totalsByParticipant: Record<string, number> = {};
        const countsByParticipant: Record<string, number> = {};

        if (participantIds.length) {
          const pairs = Object.keys(pidMap).map((roundId) => ({
            roundId,
            participantId: pidMap[roundId],
          }));

          for (const batch of chunk(pairs, 25)) {
            const orExpr = batch.map((p) => `and(round_id.eq.${p.roundId},participant_id.eq.${p.participantId})`).join(",");

            const { data: scores, error: sErr } = await supabase
              .from("round_current_scores")
              .select("round_id, participant_id, strokes")
              .or(orExpr);

            if (sErr) continue;

            for (const row of (scores ?? []) as any[]) {
              const p = row.participant_id as string;
              const n = toNumberMaybe(row.strokes);
              if (n == null) continue;

              totalsByParticipant[p] = (totalsByParticipant[p] ?? 0) + n;
              countsByParticipant[p] = (countsByParticipant[p] ?? 0) + 1;
            }
          }
        }

        const totalByRound: Record<string, number> = {};
        for (const roundId of Object.keys(pidMap)) {
          const participantId = pidMap[roundId];
          const count = countsByParticipant[participantId] ?? 0;
          if (count > 0) totalByRound[roundId] = totalsByParticipant[participantId] ?? 0;
        }

        if (!cancelled) setMyTotalByRoundId(totalByRound);

        // 4) Handicap round results (AGS + SD + HI used)
        const agsMap: Record<string, number> = {};
        const sdMap: Record<string, number> = {};
        const hiUsedMap: Record<string, number> = {};

        if (participantIds.length) {
          for (const ids of chunk(participantIds, 150)) {
            const { data: hrr, error: hErr } = await supabase
              .from("handicap_round_results")
              .select("round_id, participant_id, adjusted_gross_score, score_differential, handicap_index_used")
              .in("participant_id", ids);

            if (hErr) continue;
            for (const row of (hrr ?? []) as any[]) {
              const rid = row.round_id as string;
              const ags = toNumberMaybe(row.adjusted_gross_score);
              const sd = toNumberMaybe(row.score_differential);
              const hiUsed = toNumberMaybe(row.handicap_index_used);
              if (ags != null) agsMap[rid] = ags;
              if (sd != null) sdMap[rid] = sd;
              if (hiUsed != null) hiUsedMap[rid] = hiUsed;
            }
          }
        }

        if (!cancelled) {
          setAgsByRoundId(agsMap);
          setScoreDiffByRoundId(sdMap);
          setHiUsedByRoundId(hiUsedMap);
        }

        // 5) Handicap index history -> compute BOTH "HI after" and "HI before"
        const { data: hist, error: hErr2 } = await supabase
          .from("handicap_index_history")
          .select("as_of_date, handicap_index")
          .eq("profile_id", pid)
          .not("handicap_index", "is", null)
          .order("as_of_date", { ascending: true });

        if (hErr2) throw hErr2;

        const histRows = ((hist ?? []) as any[])
          .map((r) => ({
            as_of_date: String(r.as_of_date),
            handicap_index: Number(r.handicap_index),
          }))
          .filter((r) => r.as_of_date && Number.isFinite(r.handicap_index)) as HandicapHistoryRow[];

        function hiAsOfInclusive(dateIso: string | null): number | null {
          if (!dateIso || !histRows.length) return null;
          const target = new Date(dateIso).getTime();
          if (!Number.isFinite(target)) return null;

          let lo = 0;
          let hi = histRows.length - 1;
          let bestIdx = -1;

          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const t = new Date(histRows[mid].as_of_date).getTime();
            if (!Number.isFinite(t)) {
              lo = mid + 1;
              continue;
            }
            if (t <= target) {
              bestIdx = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }

          return bestIdx >= 0 ? histRows[bestIdx].handicap_index : null;
        }

        const hiAfterMap: Record<string, number> = {};

        for (const r of extracted) {
          const dateIso = r.started_at ?? r.created_at;

          const after = hiAsOfInclusive(dateIso);
          if (after != null) hiAfterMap[r.id] = after;
        }

        if (!cancelled) {
          setHiAfterByRoundId(hiAfterMap);
        }

        if (!cancelled) setLoading(false);
      } catch (e: any) {
        console.warn("History load error:", e);
        if (!cancelled) {
          setError(e?.message ? String(e.message) : "Could not load round history.");
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [profileFromQuery]);

  // ✅ Counting / cutoff alignment with player page
  const scoringRoundsNewestFirst = useMemo(() => {
    return rounds
      .map((r) => {
        const sd = scoreDiffByRoundId[r.id];
        return typeof sd === "number" ? { roundId: r.id, sd } : null;
      })
      .filter(Boolean) as { roundId: string; sd: number }[];
  }, [rounds, scoreDiffByRoundId]);

  const window20 = useMemo(() => scoringRoundsNewestFirst.slice(0, 20), [scoringRoundsNewestFirst]);

  const usedCount = useMemo(() => usedDifferentialsCount(window20.length), [window20.length]);

  const countingSet = useMemo(() => {
    if (usedCount <= 0) return new Set<string>();
    const sortedBySd = [...window20].sort((a, b) => a.sd - b.sd);
    const used = sortedBySd.slice(0, usedCount).map((x) => x.roundId);
    return new Set(used);
  }, [window20, usedCount]);

  const cutoffRoundId = useMemo(() => {
    if (!window20.length) return null;
    return window20[window20.length - 1].roundId;
  }, [window20]);

  const acceptableRounds = useMemo(
    () => rounds.filter((r) => typeof scoreDiffByRoundId[r.id] === "number"),
    [rounds, scoreDiffByRoundId]
  );

  const nonAcceptableRounds = useMemo(
    () => rounds.filter((r) => typeof scoreDiffByRoundId[r.id] !== "number"),
    [rounds, scoreDiffByRoundId]
  );

  const acceptableGrouped = useMemo(() => {
    const m = new Map<string, RoundRow[]>();
    for (const r of acceptableRounds) {
      const k = monthKey(r.started_at ?? r.created_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [acceptableRounds]);

  const nonAcceptableGrouped = useMemo(() => {
    const m = new Map<string, RoundRow[]>();
    for (const r of nonAcceptableRounds) {
      const k = monthKey(r.started_at ?? r.created_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [nonAcceptableRounds]);

  function renderRoundRow(r: RoundRow, showCountingDecorations: boolean) {
    const course = one(r.courses)?.name ?? "Unknown course";
    const played = shortDate(r.started_at ?? r.created_at);
    const titleText = r.name?.trim() ? r.name.trim() : course;
    const teeName = teeNameByRoundId[r.id] ?? "\u2014";

    const href = { pathname: `/round/${r.id}`, query: { from: "history" } } as const;

    const total = myTotalByRoundId[r.id];
    const scoreText = typeof total === "number" ? String(total) : "\u2014";

    const ags = agsByRoundId[r.id];
    const agsText = typeof ags === "number" ? `(${ags})` : "";

    const sd = scoreDiffByRoundId[r.id];
    const sdText = typeof sd === "number" ? `Score Diff: ${sd.toFixed(1)}` : "SD \u2014";

    const hiUsed = hiUsedByRoundId[r.id];
    const hiAfter = hiAfterByRoundId[r.id];

    const hiText = typeof hiUsed === "number" ? `Index: ${hiUsed.toFixed(1)}` : "\u2014";

    const isExceptional =
      typeof hiUsed === "number" && typeof sd === "number" && sd <= hiUsed - 7;

    const isCounting = showCountingDecorations && countingSet.has(r.id);
    const isCutoff = showCountingDecorations && cutoffRoundId === r.id;

    return (
      <Link
        key={r.id}
        href={href}
        className={[
          "block p-3 sm:p-4 hover:bg-emerald-900/15 transition-colors",
          isCounting ? "rounded-2xl ring-2 ring-[#f5e6b0]/80" : "",
          isCutoff ? "border-b-6 border-b-[#f5e6b0]" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={typeof hiAfter === "number" ? `HI after: ${hiAfter.toFixed(1)}` : undefined}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] sm:text-[14px] font-semibold text-emerald-50 truncate">
              {titleText}
            </div>
            <div className="text-[11px] sm:text-[12px] text-emerald-100/70 truncate">
              {teeName} &middot; {played}
            </div>
          </div>

          <div className="shrink-0 grid grid-cols-2 gap-4 items-center">
            <div className="text-right">
              <div className="text-[16px] font-extrabold tabular-nums text-emerald-50 leading-none">
                {hiText}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-emerald-100/60">
                <span className="inline-flex items-center gap-1 justify-end">
                  {sdText}
                  {isExceptional && (
                    <span className="text-[#f5e6b0]/80" title="Exceptional round">
                      ✨
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[18px] font-extrabold tabular-nums text-[#f5e6b0] leading-none">
                {scoreText}
              </div>
              <div className="mt-1 text-[10px] text-emerald-100/60">{agsText || "\u00A0"}</div>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  const title = useMemo(() => {
    const who = profileRow?.name || profileRow?.email || (profileFromQuery ? "Player" : "You");
    if (loading) return "Round history";
    if (error) return "Round history";
    return rounds.length ? `${who} · Round history (${rounds.length})` : `${who} · Round history`;
  }, [loading, error, rounds.length, profileRow, profileFromQuery]);

  return (
    <div className="h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4">
      <div className="mx-auto w-full max-w-3xl h-full flex flex-col">
        {/* ✅ Sticky Header */}
        <header className="sticky top-0 z-20 bg-[#042713] pb-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.replace("/")}
            >
              ← Back
            </Button>

            <div className="text-center flex-1 min-w-0 px-2">
              <div className="text-[15px] sm:text-base font-semibold tracking-wide text-[#f5e6b0] truncate">{title}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">
                {window20.length >= 3 && usedCount > 0 ? `${usedCount} of ${window20.length} counting` : "Finished rounds"}
              </div>
            </div>

            <div className="w-[64px]" />
          </div>
        </header>

        {/* ✅ Only this area scrolls */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
          {loading && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
              Loading…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4">
              <p className="text-sm text-red-100">{error}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  className="border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>

                {!profileFromQuery && (
                  <Button
                    variant="outline"
                    className="border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      window.location.href = "/login";
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </div>
            </div>
          )}

          {!loading && !error && rounds.length === 0 && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 space-y-2">
              <div className="text-sm font-semibold text-emerald-50">No finished rounds yet</div>
              <p className="text-[12px] text-emerald-100/70">Finish a round and it will show up here.</p>
              <Button asChild variant="ghost" size="sm" className="mt-2 px-2 text-emerald-100 hover:bg-emerald-900/20">
                <Link href="/round">Go to rounds</Link>
              </Button>
            </div>
          )}

          {!loading && !error && rounds.length > 0 && (
            <Tabs defaultValue="acceptable" className="space-y-3">
              <TabsList className="w-full bg-emerald-900/30 border border-emerald-900/70 rounded-xl p-1">
                <TabsTrigger
                  value="acceptable"
                  className="flex-1 text-[11px] font-semibold rounded-lg data-[state=active]:bg-[#f5e6b0] data-[state=active]:text-[#042713] text-emerald-100/80 data-[state=active]:shadow-none border-none"
                >
                  Acceptable ({acceptableRounds.length})
                </TabsTrigger>
                <TabsTrigger
                  value="non-acceptable"
                  className="flex-1 text-[11px] font-semibold rounded-lg data-[state=active]:bg-[#f5e6b0] data-[state=active]:text-[#042713] text-emerald-100/80 data-[state=active]:shadow-none border-none"
                >
                  Non-Acceptable ({nonAcceptableRounds.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="acceptable">
                {acceptableRounds.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/70">
                    No acceptable rounds yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {acceptableGrouped.map(([month, list]) => (
                      <section key={month} className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70">{month}</div>
                          <div className="text-[11px] text-emerald-100/60">{list.length}</div>
                        </div>

                        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
                          <div className="p-2 space-y-2">
                            {list.map((r) => renderRoundRow(r, true))}
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="non-acceptable">
                {nonAcceptableRounds.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/70">
                    No non-acceptable rounds.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {nonAcceptableGrouped.map(([month, list]) => (
                      <section key={month} className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70">{month}</div>
                          <div className="text-[11px] text-emerald-100/60">{list.length}</div>
                        </div>

                        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
                          <div className="p-2 space-y-2">
                            {list.map((r) => renderRoundRow(r, false))}
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}

          {/* optional debug hint */}
          {!loading && !error && profileId && (
            <p className="text-[10px] text-emerald-100/40 px-1 mt-4">Profile: {profileId}</p>
          )}
        </div>
      </div>
    </div>
  );
}

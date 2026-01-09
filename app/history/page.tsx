"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

type RoundRow = {
  id: string;
  name: string | null;
  status: "draft" | "live" | "finished" | string;
  started_at: string | null;
  created_at: string | null;
  course_id: string | null;

  // join can come back as object or array depending on inference
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

export default function RoundsHistoryPage() {
  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [participantIdByRoundId, setParticipantIdByRoundId] = useState<Record<string, string>>({});
  const [teeNameByRoundId, setTeeNameByRoundId] = useState<Record<string, string>>({});
  const [myTotalByRoundId, setMyTotalByRoundId] = useState<Record<string, number>>({});

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) {
        if (!cancelled) {
          setError("You must be signed in to view your round history.");
          setLoading(false);
        }
        return;
      }

      const pid = await getMyProfileIdByAuthUserId(authData.user.id);
      if (!pid) {
        if (!cancelled) {
          setError("Could not find your profile.");
          setLoading(false);
        }
        return;
      }
      if (!cancelled) setProfileId(pid);

      // 1) Load my participant rows + round info (no tee snapshot join here)
      const { data, error: qErr } = await supabase
        .from("round_participants")
        .select(
          `
            id,
            round_id,
            tee_snapshot_id,
            rounds:rounds (
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

      if (qErr) {
        if (!cancelled) {
          setError(qErr.message);
          setLoading(false);
        }
        return;
      }

      const rows = (data ?? []) as ParticipantRow[];

      // extract rounds, finished only
      const extractedAll: RoundRow[] = rows.map((r) => one(r.rounds)).filter(Boolean) as RoundRow[];
      const extracted = extractedAll.filter((r) => isFinishedStatus(r.status));

      // map roundId -> my participantId (important!) + roundId -> tee_snapshot_id
      const pidMap: Record<string, string> = {};
      const teeSnapIdByRound: Record<string, string> = {};

      for (const pr of rows) {
        const round = one(pr.rounds);
        if (!round) continue;
        if (!isFinishedStatus(round.status)) continue;

        pidMap[round.id] = pr.id; // ✅ this is what round_current_scores uses
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

      // 2) Load tee names in a second query (avoid relationship cache errors)
      const teeIds = Array.from(new Set(Object.values(teeSnapIdByRound).filter(Boolean)));
      const teeNameMap: Record<string, string> = {};

      if (teeIds.length) {
        // fetch in chunks to avoid long URL issues
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

      // 3) Load MY totals (robust): fetch by round_id + participant_id to avoid PostgREST row caps
      const myParticipantIds = Array.from(new Set(Object.values(pidMap).filter(Boolean)));
      const totalsByParticipant: Record<string, number> = {};
      const countsByParticipant: Record<string, number> = {}; // ✅ track whether we saw any numeric strokes

      if (myParticipantIds.length) {
        // Build (round_id, participant_id) pairs so we can query each round tightly (max 18 rows per round)
        const pairs = Object.keys(pidMap).map((roundId) => ({
          roundId,
          participantId: pidMap[roundId],
        }));

        // chunk pairs to keep requests reasonable
        for (const batch of chunk(pairs, 25)) {
          // Build an OR filter like:
          // (round_id.eq.<rid1>,participant_id.eq.<pid1>),(round_id.eq.<rid2>,participant_id.eq.<pid2>)...
          const orExpr = batch
            .map((p) => `and(round_id.eq.${p.roundId},participant_id.eq.${p.participantId})`)
            .join(",");

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

      // ✅ only set a total if we actually summed something for that participant
      const totalByRound: Record<string, number> = {};
      for (const roundId of Object.keys(pidMap)) {
        const participantId = pidMap[roundId];
        const count = countsByParticipant[participantId] ?? 0;
        if (count > 0) {
          totalByRound[roundId] = totalsByParticipant[participantId] ?? 0;
        }
        // else: leave undefined so UI shows "—" instead of "0"
      }

      if (!cancelled) {
        setMyTotalByRoundId(totalByRound);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, RoundRow[]>();
    for (const r of rounds) {
      const k = monthKey(r.started_at ?? r.created_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [rounds]);

  const title = useMemo(() => {
    if (loading) return "Round history";
    if (error) return "Round history";
    return rounds.length ? `Round history (${rounds.length})` : "Round history";
  }, [loading, error, rounds.length]);

  return (
    <div className="h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4">
      <div className="mx-auto w-full max-w-3xl h-full flex flex-col">
        {/* ✅ Sticky Header */}
        <header className="sticky top-0 z-20 bg-[#042713] pb-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <Button asChild variant="ghost" size="sm" className="px-2 text-emerald-100 hover:bg-emerald-900/30">
              <Link href="/">← Back</Link>
            </Button>

            <div className="text-center flex-1 min-w-0 px-2">
              <div className="text-[15px] sm:text-base font-semibold tracking-wide text-[#f5e6b0] truncate">{title}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">
                Finished rounds
              </div>
            </div>

            <div className="w-[64px]" />
          </div>
        </header>

        {/* ✅ Only this area scrolls */}
        <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
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
            <div className="space-y-4">
              {grouped.map(([month, list]) => (
                <section key={month} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70">{month}</div>
                    <div className="text-[11px] text-emerald-100/60">{list.length}</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
                    <div className="divide-y divide-emerald-900/60">
                      {list.map((r) => {
                        const course = one(r.courses)?.name ?? "Unknown course";
                        const played = shortDate(r.started_at ?? r.created_at);

                        // ✅ title: name if set else course
                        const titleText = r.name?.trim() ? r.name.trim() : course;

                        // ✅ subtitle: tee name
                        const teeName = teeNameByRoundId[r.id] ?? "—";

                        // ✅ robust link with query preserved for scorecard back button
                        const href = { pathname: `/round/${r.id}`, query: { from: "history" } } as const;

                        const total = myTotalByRoundId[r.id];
                        const scoreText = typeof total === "number" ? String(total) : "—"; // ✅ no fake zeros

                        return (
                          <div key={r.id} className="p-3 sm:p-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] sm:text-[14px] font-semibold text-emerald-50 truncate">
                                {titleText}
                              </div>
                              <div className="text-[11px] sm:text-[12px] text-emerald-100/70 truncate">
                                {teeName} · {played}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <div className="text-right">
                                <div className="text-[18px] font-extrabold tabular-nums text-[#f5e6b0] leading-none">
                                  {scoreText}
                                </div>
                              </div>

                              <Button
                                asChild
                                variant="ghost"
                                size="sm"
                                className="px-2 text-emerald-100 hover:bg-emerald-900/20"
                              >
                                <Link href={href}>View</Link>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* optional debug hint */}
          {!loading && !error && profileId && (
            <p className="text-[10px] text-emerald-100/50 px-1 mt-4">Profile: {profileId}</p>
          )}
        </div>
      </div>
    </div>
  );
}

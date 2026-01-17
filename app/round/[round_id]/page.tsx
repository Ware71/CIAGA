"use client";

import React, { useEffect, useMemo, useState, useCallback, JSX } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type ProfileEmbed = { name: string | null; email: string | null; avatar_url: string | null };

type Participant = {
  id: string;
  profile_id: string | null;
  is_guest: boolean;
  display_name: string | null;
  role: "owner" | "scorer" | "player";
  tee_snapshot_id: string | null;

  handicap_index?: number | null;
  course_handicap?: number | null;

  profiles?: ProfileEmbed | ProfileEmbed[] | null;
};

type Hole = { hole_number: number; par: number | null; yardage: number | null; stroke_index: number | null };
type Score = { participant_id: string; hole_number: number; strokes: number | null; created_at: string };

function getCourseNameFromJoin(r: any): string {
  const c = r?.course;
  if (!c) return "";
  if (Array.isArray(c)) return c?.[0]?.name || "";
  return c?.name || "";
}

function initialsFrom(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase().slice(0, 2);
}

function pickProfile(p: Participant): ProfileEmbed | null {
  const prof = p.profiles ?? null;
  if (!prof) return null;
  return Array.isArray(prof) ? prof[0] ?? null : prof;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.matchMedia(query);
    const onChange = () => setMatches(m.matches);
    onChange();
    if (m.addEventListener) m.addEventListener("change", onChange);
    else m.addListener(onChange);
    return () => {
      if (m.removeEventListener) m.removeEventListener("change", onChange);
      else m.removeListener(onChange);
    };
  }, [query]);

  return matches;
}

function computeNextIncompleteHole(
  holesList: Hole[],
  participants: Participant[],
  scoreFor: (pid: string, hole: number) => number | null
) {
  if (!holesList.length) return 1;

  for (const h of holesList) {
    const allScored = participants.every((p) => typeof scoreFor(p.id, h.hole_number) === "number");
    if (!allScored) return h.hole_number;
  }

  return holesList[holesList.length - 1].hole_number;
}

function findNextUnscoredPlayerForHole(
  participants: Participant[],
  startParticipantId: string,
  holeNumber: number,
  scoreFor: (pid: string, hole: number) => number | null
): string | null {
  if (!participants.length) return null;

  const startIdx = Math.max(0, participants.findIndex((p) => p.id === startParticipantId));

  for (let step = 1; step <= participants.length; step++) {
    const idx = (startIdx + step) % participants.length;
    const pid = participants[idx].id;
    const s = scoreFor(pid, holeNumber);
    if (typeof s !== "number") return pid;
  }

  return null;
}

function countMissingForHole(
  participants: Participant[],
  holeNumber: number,
  scoreFor: (pid: string, hole: number) => number | null
) {
  let missing = 0;
  for (const p of participants) {
    if (typeof scoreFor(p.id, holeNumber) !== "number") missing += 1;
  }
  return missing;
}

type LandscapeCol =
  | { kind: "hole"; hole: Hole }
  | { kind: "outMid" }
  | { kind: "outEnd" }
  | { kind: "inEnd" }
  | { kind: "totEnd" };

type SumKind = "OUT" | "IN" | "TOT";

function sumMeta(holes: Hole[]) {
  let parOut = 0,
    parIn = 0,
    parTot = 0;
  let ydsOut = 0,
    ydsIn = 0,
    ydsTot = 0;

  let hasParOut = false,
    hasParIn = false;
  let hasYdsOut = false,
    hasYdsIn = false;

  for (const h of holes) {
    const isOut = h.hole_number <= 9;
    const isIn = h.hole_number >= 10;

    if (typeof h.par === "number") {
      parTot += h.par;
      if (isOut) {
        parOut += h.par;
        hasParOut = true;
      }
      if (isIn) {
        parIn += h.par;
        hasParIn = true;
      }
    }

    if (typeof h.yardage === "number") {
      ydsTot += h.yardage;
      if (isOut) {
        ydsOut += h.yardage;
        hasYdsOut = true;
      }
      if (isIn) {
        ydsIn += h.yardage;
        hasYdsIn = true;
      }
    }
  }

  return {
    parOut: hasParOut ? parOut : null,
    parIn: hasParIn ? parIn : null,
    parTot: hasParOut || hasParIn ? parTot : null,
    ydsOut: hasYdsOut ? ydsOut : null,
    ydsIn: hasYdsIn ? ydsIn : null,
    ydsTot: hasYdsOut || hasYdsIn ? ydsTot : null,
  };
}

/* ---------------- Net scoring helpers (display-only) ---------------- */

function strokesReceivedOnHole(courseHcp: number | null | undefined, holeStrokeIndex: number | null) {
  const hcp = typeof courseHcp === "number" && Number.isFinite(courseHcp) ? Math.max(0, Math.floor(courseHcp)) : 0;
  const si = typeof holeStrokeIndex === "number" && Number.isFinite(holeStrokeIndex) ? holeStrokeIndex : null;
  if (!hcp || !si) return 0;

  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;

  return base + (si <= rem ? 1 : 0);
}

function netFromGross(gross: number, recv: number) {
  return Math.max(1, gross - recv);
}

function formatToPar(toPar: number | null) {
  if (toPar == null) return "";
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

/* ---------------- Stroke dots ---------------- */

function StrokeDots({ count }: { count: number }) {
  const n = Math.max(0, Math.floor(count || 0));
  if (!n) return null;

  const shown = Math.min(n, 6);
  const extra = n - shown;

  return (
    <span className="inline-flex items-center gap-1">
      {Array.from({ length: shown }).map((_, i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-[#f5e6b0] border border-emerald-900/60"
        />
      ))}
      {extra > 0 ? <span className="text-[10px] text-emerald-100/70">+{extra}</span> : null}
    </span>
  );
}

/* ---------------- Finished-state helpers ---------------- */

function stableNumber(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

type FinalRow = {
  participantId: string;
  name: string;
  avatarUrl: string | null;
  total: number;
  out: number;
  in: number;
  toPar: number | null;
};

function buildFinalRows(
  participants: Participant[],
  totals: Record<string, { out: number; in: number; total: number }>,
  toParTot: Record<string, number | null>,
  getParticipantLabel: (p: Participant) => string,
  getParticipantAvatar: (p: Participant) => string | null
): FinalRow[] {
  return participants.map((p) => {
    const t = totals[p.id] ?? { out: 0, in: 0, total: 0 };
    return {
      participantId: p.id,
      name: getParticipantLabel(p),
      avatarUrl: getParticipantAvatar(p),
      total: stableNumber(t.total) ?? 0,
      out: stableNumber(t.out) ?? 0,
      in: stableNumber(t.in) ?? 0,
      toPar: toParTot[p.id] ?? null,
    };
  });
}

function formatPlayedOn(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default function RoundDetailPage() {
  const router = useRouter();
  const params = useParams<{ round_id: string }>();
  const roundId = params.round_id;

  const isPortrait = useMediaQuery("(orientation: portrait)");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);

  const [scoreView, setScoreView] = useState<"gross" | "net">("gross");

  const [roundName, setRoundName] = useState<string>("Round");
  const [status, setStatus] = useState<string>("draft");
  const [courseLabel, setCourseLabel] = useState<string>("");
  const [playedOnIso, setPlayedOnIso] = useState<string | null>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teeSnapshotId, setTeeSnapshotId] = useState<string | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [scoresByKey, setScoresByKey] = useState<Record<string, Score>>({});
  const [activeHole, setActiveHole] = useState<number>(1);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryPid, setEntryPid] = useState<string | null>(null);
  const [entryHole, setEntryHole] = useState<number | null>(null);
  const [entryMode, setEntryMode] = useState<"quick" | "custom">("quick");
  const [customVal, setCustomVal] = useState<string>("10");

  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const holeCount = holes.length || 18;

  const scoreFor = useCallback(
    (participantId: string, holeNumber: number) => scoresByKey[`${participantId}:${holeNumber}`]?.strokes ?? null,
    [scoresByKey]
  );

  const canScore = useMemo(() => {
    if (!meId) return false;
    const me = participants.find((p) => p.profile_id === meId);
    return !!me && (me.role === "owner" || me.role === "scorer");
  }, [participants, meId]);

  const isFinished = status === "completed" || status === "finished" || status === "ended";

  const holesList: Hole[] = useMemo(() => {
    return holes.length > 0
      ? holes
      : (Array.from({ length: holeCount }, (_, i) => ({
          hole_number: i + 1,
          par: null,
          yardage: null,
          stroke_index: null,
        })) as Hole[]);
  }, [holes, holeCount]);

  const metaSums = useMemo(() => sumMeta(holesList), [holesList]);

  const getParticipantLabel = useCallback((p: Participant) => {
    const prof = pickProfile(p);
    return p.display_name || prof?.name || prof?.email || (p.profile_id ? "Player" : "Guest");
  }, []);

  const getParticipantAvatar = useCallback((p: Participant) => {
    const prof = pickProfile(p);
    return prof?.avatar_url || null;
  }, []);

  const displayedScoreFor = useCallback(
    (participantId: string, holeNumber: number) => {
      const gross = scoreFor(participantId, holeNumber);
      if (typeof gross !== "number") return null;
      if (scoreView === "gross") return gross;

      const p = participants.find((x) => x.id === participantId);
      const h = holesList.find((x) => x.hole_number === holeNumber);

      const recv = strokesReceivedOnHole(p?.course_handicap ?? null, h?.stroke_index ?? null);
      return netFromGross(gross, recv);
    },
    [scoreFor, scoreView, participants, holesList]
  );

  const totals = useMemo(() => {
    const byParticipant: Record<string, { out: number; in: number; total: number }> = {};
    for (const p of participants) {
      let out = 0,
        inn = 0,
        total = 0;

      for (const h of holesList) {
        const s = displayedScoreFor(p.id, h.hole_number);
        if (typeof s === "number") {
          total += s;
          if (h.hole_number <= 9) out += s;
          else inn += s;
        }
      }

      byParticipant[p.id] = { out, in: inn, total };
    }
    return byParticipant;
  }, [participants, holesList, displayedScoreFor]);

  // par - (gross/net total) as requested
  const toParTotalByParticipant = useMemo(() => {
    const map: Record<string, number | null> = {};
    const parTot = metaSums.parTot;
    for (const p of participants) {
      if (typeof parTot !== "number") {
        map[p.id] = null;
        continue;
      }
      const t = totals[p.id]?.total ?? 0;
      map[p.id] = t - parTot;
    }
    return map;
  }, [participants, totals, metaSums.parTot]);

  const landscapePlan: LandscapeCol[] = useMemo(() => {
    const front = holesList.filter((h) => h.hole_number <= 9);
    const back = holesList.filter((h) => h.hole_number >= 10);

    const cols: LandscapeCol[] = [];
    for (const h of front) cols.push({ kind: "hole", hole: h });
    if (front.length) cols.push({ kind: "outMid" });
    for (const h of back) cols.push({ kind: "hole", hole: h });

    cols.push({ kind: "outEnd" }, { kind: "inEnd" }, { kind: "totEnd" });
    return cols;
  }, [holesList]);

  const playedOnLabel = playedOnIso ? formatPlayedOn(playedOnIso) : "";

  const finalRows = useMemo(() => {
    const rows = buildFinalRows(participants, totals, toParTotalByParticipant, getParticipantLabel, getParticipantAvatar);
    rows.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
    return rows;
  }, [participants, totals, toParTotalByParticipant, getParticipantLabel, getParticipantAvatar]);

  const winner = finalRows[0] ?? null;

  const fetchAll = useCallback(async () => {
    setErr(null);

    let myProfileId: string | null = null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user) myProfileId = await getMyProfileIdByAuthUserId(auth.user.id);
    } catch {
      myProfileId = null;
    }
    setMeId(myProfileId);

    const roundRes = await supabase
      .from("rounds")
      .select("id,name,status, started_at, created_at, course:courses(name)")
      .eq("id", roundId)
      .single();
    if (roundRes.error) throw roundRes.error;

    const r = roundRes.data as any;
    const courseName = getCourseNameFromJoin(r);

    setRoundName(r.name || courseName || "Round");
    setStatus(r.status);
    setCourseLabel(courseName);

    setPlayedOnIso((r.started_at as string | null) ?? (r.created_at as string | null) ?? null);

    const partRes = await supabase.rpc("get_round_participants", { _round_id: roundId });
    if (partRes.error) throw partRes.error;

    const toNumOrNull = (v: any) => {
      if (v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const mappedParticipants = ((partRes.data ?? []) as any[]).map((row) => ({
      id: row.id,
      profile_id: row.profile_id,
      is_guest: row.is_guest,
      display_name: row.display_name,
      role: row.role,
      tee_snapshot_id: row.tee_snapshot_id,
      handicap_index: toNumOrNull(row.handicap_index),
      course_handicap: toNumOrNull(row.course_handicap),
      profiles: {
        name: row.name,
        email: row.email,
        avatar_url: row.avatar_url,
      },
    })) as Participant[];

    setParticipants(mappedParticipants);

    const teeId = mappedParticipants.find((p: any) => p.tee_snapshot_id)?.tee_snapshot_id ?? null;
    setTeeSnapshotId(teeId);

    if (teeId) {
      const holesRes = await supabase
        .from("round_hole_snapshots")
        .select("hole_number,par,yardage,stroke_index")
        .eq("round_tee_snapshot_id", teeId)
        .order("hole_number", { ascending: true });
      if (holesRes.error) throw holesRes.error;

      setHoles((holesRes.data ?? []) as Hole[]);
    } else {
      setHoles([]);
    }

    const scoreRes = await supabase
      .from("round_current_scores")
      .select("participant_id,hole_number,strokes,created_at")
      .eq("round_id", roundId);
    if (scoreRes.error) throw scoreRes.error;

    const map: Record<string, Score> = {};
    for (const s of (scoreRes.data ?? []) as Score[]) map[`${s.participant_id}:${s.hole_number}`] = s;
    setScoresByKey(map);
  }, [roundId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchAll();
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load round");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  useEffect(() => {
    if (!roundId) return;

    const channel = supabase
      .channel(`round:${roundId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "round_score_events", filter: `round_id=eq.${roundId}` },
        (payload) => {
          const row = payload.new as any;
          const key = `${row.participant_id}:${row.hole_number}`;
          setScoresByKey((prev) => ({
            ...prev,
            [key]: {
              participant_id: row.participant_id,
              hole_number: row.hole_number,
              strokes: row.strokes,
              created_at: row.created_at,
            },
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roundId]);

  useEffect(() => {
    if (!roundId) return;
    const chan = supabase
      .channel(`round-meta:${roundId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_participants", filter: `round_id=eq.${roundId}` },
        () => fetchAll()
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rounds", filter: `id=eq.${roundId}` }, () =>
        fetchAll()
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "round_hole_snapshots" }, () => fetchAll())
      .subscribe();

    return () => {
      supabase.removeChannel(chan);
    };
  }, [roundId, fetchAll]);

  useEffect(() => {
    if (isFinished) return;
    if (!participants.length || !holesList.length) return;
    const next = computeNextIncompleteHole(holesList, participants, scoreFor);
    setActiveHole((prev) => (prev === next ? prev : next));
  }, [participants, holesList, scoreFor, isFinished]);

  async function setScore(participantId: string, holeNumber: number, strokes: number | null) {
    if (!meId) return false;
    if (!canScore) {
      setErr("You don’t have permission to enter scores in this round.");
      return false;
    }
    if (isFinished) {
      setErr("This round has been finished.");
      return false;
    }

    const key = `${participantId}:${holeNumber}`;
    setSavingKey(key);
    setErr(null);

    try {
      const { error } = await supabase.from("round_score_events").insert({
        round_id: roundId,
        participant_id: participantId,
        hole_number: holeNumber,
        strokes,
        entered_by: meId,
      });
      if (error) throw error;

      setScoresByKey((prev) => ({
        ...prev,
        [key]: {
          participant_id: participantId,
          hole_number: holeNumber,
          strokes,
          created_at: new Date().toISOString(),
        },
      }));

      return true;
    } catch (e: any) {
      setErr(e?.message || "Failed to save score");
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  async function finishRound() {
    if (!canScore || isFinished) return;
    setErr(null);
    setFinishing(true);
    try {
      const { error } = await supabase.from("rounds").update({ status: "finished" }).eq("id", roundId);
      if (error) throw error;
      setFinishOpen(false);
      setStatus("finished");
      setEntryOpen(false);
    } catch (e: any) {
      setErr(e?.message || "Failed to finish round");
    } finally {
      setFinishing(false);
    }
  }

  function closeEntry() {
    setEntryOpen(false);
    setEntryPid(null);
    setEntryHole(null);
    setEntryMode("quick");
    setCustomVal("10");
  }

  function openEntry(participantId: string, holeNumber: number) {
    if (!canScore || isFinished) return;
    setEntryPid(participantId);
    setEntryHole(holeNumber);
    setEntryMode("quick");
    setCustomVal("10");
    setEntryOpen(true);
  }

  async function submitAndAdvance(strokes: number | null) {
    if (!entryPid || entryHole == null) return;

    const ok = await setScore(entryPid, entryHole, strokes);
    if (!ok) return;

    const missingNow = countMissingForHole(participants, entryHole, scoreFor);
    if (missingNow === 0) {
      closeEntry();
      return;
    }

    const nextPid = findNextUnscoredPlayerForHole(participants, entryPid, entryHole, scoreFor);
    if (nextPid) {
      setEntryPid(nextPid);
      setEntryMode("quick");
      setCustomVal("10");
    } else {
      closeEntry();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-3 pt-6">
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
          Loading…
        </div>
      </div>
    );
  }

  const hasStarted = status === "live" || isFinished;
  const needsSetup = !hasStarted || !teeSnapshotId;
  const canFinish = hasStarted && !!teeSnapshotId && canScore && !isFinished;

  const compactPlayers = participants.length >= 6;
  const portraitCols = `30px 32px 38px 30px repeat(${participants.length}, minmax(0, 1fr))`;
  const landscapeCols = `140px repeat(${landscapePlan.length}, minmax(0, 1fr))`;

  const portraitTag = (text: string) => <div className="text-[10px] font-semibold leading-none">{text}</div>;

  const sumPar = (k: SumKind) => (k === "OUT" ? metaSums.parOut : k === "IN" ? metaSums.parIn : metaSums.parTot);
  const sumYds = (k: SumKind) => (k === "OUT" ? metaSums.ydsOut : k === "IN" ? metaSums.ydsIn : metaSums.ydsTot);

  const subtitle = `${status}${playedOnLabel ? ` · ${playedOnLabel}` : ""}`;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-none space-y-2">
        <header className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => {
              const sp = new URLSearchParams(window.location.search);
              const from = sp.get("from");
              if (from === "history") {
                router.push("/history");
              } else if (from === "player") {
                router.back();
              } else {
                router.push("/round");
              }
            }}
          >
            ← Back
          </Button>

          <div className="text-center flex-1 px-1 min-w-0">
            <div className="text-[15px] sm:text-base font-semibold tracking-wide text-[#f5e6b0] truncate">
              {roundName}
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">{subtitle}</div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/50 p-1 flex">
              <button
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg ${
                  scoreView === "gross"
                    ? "bg-[#f5e6b0] text-[#042713]"
                    : "text-emerald-100/80 hover:bg-emerald-900/20"
                }`}
                onClick={() => setScoreView("gross")}
              >
                Gross
              </button>
              <button
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg ${
                  scoreView === "net"
                    ? "bg-[#f5e6b0] text-[#042713]"
                    : "text-emerald-100/80 hover:bg-emerald-900/20"
                }`}
                onClick={() => setScoreView("net")}
              >
                Net
              </button>
            </div>

            {canFinish ? (
              <Button
                size="sm"
                className="rounded-xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c] px-3"
                onClick={() => setFinishOpen(true)}
              >
                Finish
              </Button>
            ) : null}
          </div>
        </header>

        {err ? (
          <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-100">{err}</div>
        ) : null}

        {needsSetup ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
            <div className="text-sm font-semibold text-emerald-50">Round not started</div>
            <div className="text-[11px] text-emerald-100/70">
              Select players and start the round to generate tee + hole snapshots.
            </div>
            {canScore ? (
              <Button
                className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                onClick={() => router.replace(`/round/${roundId}/setup`)}
              >
                Go to setup
              </Button>
            ) : (
              <div className="text-[11px] text-emerald-100/70">
                You can view this round, but only participants can set it up.
              </div>
            )}
          </div>
        ) : null}

        {/* Finished: winner pinned */}
        {!needsSetup && isFinished && winner ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
            <div className="p-4 border-b border-emerald-900/60">
              <div className="text-sm font-semibold text-[#f5e6b0]">Final results</div>
              <div className="text-[11px] text-emerald-100/70 mt-1">Scores are locked. This is the final scorecard.</div>
            </div>

            <div className="p-3">
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-full border border-emerald-900/70 bg-[#0b3b21]/50 px-2.5 py-1 text-[10px] font-bold text-emerald-100/90">
                    WINNER
                  </div>
                  <Avatar className="h-9 w-9 border border-emerald-200/70 shrink-0">
                    {winner.avatarUrl ? <AvatarImage src={winner.avatarUrl} /> : null}
                    <AvatarFallback className="text-[10px]">{initialsFrom(winner.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-emerald-50 truncate">{winner.name}</div>
                    <div className="text-[11px] text-emerald-100/70">
                      OUT {winner.out} · IN {winner.in}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-100/70">Total</div>
                  <div className="text-2xl font-extrabold tabular-nums text-[#f5e6b0]">
                    {winner.total}{" "}
                    <span className="text-[12px] font-bold text-emerald-100/80 ml-1">
                      {winner.toPar != null ? `(${formatToPar(winner.toPar)})` : ""}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="divide-y divide-emerald-900/60">
              {finalRows.map((r, idx) => {
                const prev = finalRows[idx - 1];
                const rank = idx === 0 ? 1 : prev && prev.total === r.total ? null : idx + 1;

                return (
                  <div key={r.participantId} className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 text-center text-[12px] font-bold text-emerald-100/90">{rank ?? "•"}</div>

                      <Avatar className="h-8 w-8 border border-emerald-200/70 shrink-0">
                        {r.avatarUrl ? <AvatarImage src={r.avatarUrl} /> : null}
                        <AvatarFallback className="text-[10px]">{initialsFrom(r.name)}</AvatarFallback>
                      </Avatar>

                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-emerald-50 truncate">{r.name}</div>
                        <div className="text-[11px] text-emerald-100/70">
                          OUT {r.out} · IN {r.in}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-100/70">Total</div>
                      <div className="text-xl font-extrabold tabular-nums text-[#f5e6b0]">
                        {r.total}{" "}
                        <span className="text-[12px] font-bold text-emerald-100/80 ml-1">
                          {r.toPar != null ? `(${formatToPar(r.toPar)})` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Scorecard */}
        {!needsSetup ? (
          isPortrait ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
              <div className="w-full">
                <div className="w-full" style={{ display: "grid", gridTemplateColumns: portraitCols }}>
                  {/* Header row (portrait: compact) */}
                  <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
                    {portraitTag("#")}
                  </div>
                  <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
                    {portraitTag("Par")}
                  </div>
                  <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
                    {portraitTag("Yds")}
                  </div>
                  <div className="h-7 flex items-center justify-center text-emerald-100/80 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60">
                    {portraitTag("SI")}
                  </div>

                  {participants.map((p) => {
                    const name = getParticipantLabel(p);
                    const avatarUrl = getParticipantAvatar(p);
                    const hi = typeof p.handicap_index === "number" ? p.handicap_index.toFixed(1) : "–";
                    const ch = typeof p.course_handicap === "number" ? String(p.course_handicap) : "–";

                    const title = `${name} · HI ${hi} · CH ${ch}`;

                    return (
                      <div
                        key={`ph-${p.id}`}
                        className="h-7 px-1 flex items-center justify-center border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 min-w-0"
                        title={title}
                      >
                        {compactPlayers ? (
                          <div className="text-[10px] font-semibold text-emerald-50">{initialsFrom(name)}</div>
                        ) : (
                          <div className="flex items-center gap-1 min-w-0">
                            <Avatar className="h-4.5 w-4.5 border border-emerald-200/70 shrink-0">
                              {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                              <AvatarFallback className="text-[8px]">{initialsFrom(name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col items-start min-w-0">
                              <div className="text-[10px] text-emerald-50 truncate min-w-0 leading-none">{name}</div>
                              <div className="text-[9px] text-emerald-100/60 leading-none">
                                HI {hi} · CH {ch}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Hole rows + OUT between 9 and 10 */}
                  {holesList.flatMap((h) => {
                    const nodes: JSX.Element[] = [];
                    const isActive = !isFinished && h.hole_number === activeHole;

                    const metaCell = (v: any, key: string) => (
                      <div
                        key={key}
                        className={`h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 ${
                          isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/25 text-emerald-100/80"
                        }`}
                      >
                        {v ?? "–"}
                      </div>
                    );

                    nodes.push(
                      metaCell(h.hole_number, `h-${h.hole_number}-n`),
                      metaCell(h.par, `h-${h.hole_number}-p`),
                      metaCell(h.yardage, `h-${h.hole_number}-y`),
                      metaCell(h.stroke_index, `h-${h.hole_number}-si`)
                    );

                    participants.forEach((p) => {
                      const s = displayedScoreFor(p.id, h.hole_number);
                      const key = `${p.id}:${h.hole_number}`;
                      const disabled = !canScore || isFinished;

                      const recv =
                        scoreView === "net"
                          ? strokesReceivedOnHole(p.course_handicap ?? null, h.stroke_index ?? null)
                          : 0;

                      nodes.push(
                        <button
                          key={`sc-${key}`}
                          className={`h-9 border-b border-r border-emerald-900/60 flex flex-col items-center justify-center font-semibold tabular-nums
                            ${compactPlayers ? "text-[12px]" : "text-[13px]"}
                            ${isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/15 text-emerald-50"}
                            ${disabled ? "opacity-80 cursor-default" : "hover:bg-emerald-900/20"}
                          `}
                          onClick={() => openEntry(p.id, h.hole_number)}
                          disabled={disabled}
                        >
                          <div className="leading-none">{savingKey === key ? "…" : s ?? "–"}</div>
                          {scoreView === "net" && recv > 0 ? (
                            <div className="mt-1 leading-none">
                              <StrokeDots count={recv} />
                            </div>
                          ) : (
                            <div className="h-[6px]" />
                          )}
                        </button>
                      );
                    });

                    if (h.hole_number === 9) {
                      const parOut = sumPar("OUT");
                      const ydsOut = sumYds("OUT");

                      nodes.push(
                        <div
                          key="out-mid-label"
                          className="h-9 flex items-center justify-center text-[10px] font-semibold border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                        >
                          OUT
                        </div>,
                        <div
                          key="out-mid-par"
                          className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                        >
                          {parOut ?? "–"}
                        </div>,
                        <div
                          key="out-mid-yds"
                          className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                        >
                          {ydsOut ?? "–"}
                        </div>,
                        <div key="out-mid-si" className="h-9 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60" />
                      );

                      participants.forEach((p) => {
                        const par = metaSums.parOut;
                        const val = totals[p.id]?.out ?? 0;
                        const toPar = typeof par === "number" ? val - par : null;

                        nodes.push(
                          <div
                            key={`out-mid-${p.id}`}
                            className="h-9 border-b border-r border-emerald-900/60 flex flex-col items-center justify-center font-bold tabular-nums text-[12px] bg-[#0b3b21]/35 text-emerald-50"
                          >
                            <div className="leading-none">{val}</div>
                            <div className="text-[10px] font-semibold text-emerald-100/70 leading-none">
                              {toPar != null ? formatToPar(toPar) : ""}
                            </div>
                          </div>
                        );
                      });
                    }

                    return nodes;
                  })}

                  {/* Totals rows at end: OUT / IN / TOT */}
                  {(["OUT", "IN", "TOT"] as const).flatMap((label) => {
                    const isTot = label === "TOT";
                    const nodes: JSX.Element[] = [];

                    const par = sumPar(label);
                    const yds = sumYds(label);

                    nodes.push(
                      <div
                        key={`lbl-${label}`}
                        className="h-9 flex items-center justify-center text-[10px] font-semibold border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                      >
                        {label}
                      </div>,
                      <div
                        key={`par-${label}`}
                        className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                      >
                        {par ?? "–"}
                      </div>,
                      <div
                        key={`yds-${label}`}
                        className="h-9 flex items-center justify-center text-[11px] border-b border-r border-emerald-900/60 bg-[#0b3b21]/60 text-emerald-100/80"
                      >
                        {yds ?? "–"}
                      </div>,
                      <div key={`si-${label}`} className="h-9 border-b border-r border-emerald-900/60 bg-[#0b3b21]/60" />
                    );

                    participants.forEach((p) => {
                      const t = totals[p.id];
                      const val = label === "OUT" ? t?.out ?? 0 : label === "IN" ? t?.in ?? 0 : t?.total ?? 0;
                      const toPar = typeof par === "number" ? val - par : null;

                      nodes.push(
                        <div
                          key={`tot-${label}-${p.id}`}
                          className={`h-9 border-b border-r border-emerald-900/60 flex flex-col items-center justify-center font-bold tabular-nums ${
                            compactPlayers ? "text-[12px]" : "text-[13px]"
                          } ${isTot ? "bg-[#f5e6b0] text-[#042713]" : "bg-[#0b3b21]/40 text-emerald-50"}`}
                        >
                          <div className="leading-none">{val}</div>
                          <div
                            className={`text-[10px] font-semibold leading-none ${
                              isTot ? "text-[#042713]/70" : "text-emerald-100/70"
                            }`}
                          >
                            {toPar != null ? formatToPar(toPar) : ""}
                          </div>
                        </div>
                      );
                    });

                    return nodes;
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* Landscape scorecard unchanged except totals include to-par and name cell shows HI/CH */
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[860px]">
                  <div className="grid" style={{ gridTemplateColumns: landscapeCols }}>
                    <div className="border-b border-emerald-900/60 bg-[#0b3b21]/70">
                      {["HOLE", "PAR", "YDS", "SI"].map((lbl) => (
                        <div
                          key={lbl}
                          className="h-7 px-2.5 flex items-center text-[10px] text-emerald-100/70 border-b border-emerald-900/60 last:border-b-0"
                        >
                          {lbl}
                        </div>
                      ))}
                    </div>

                    {landscapePlan.map((c, idx) => {
                      const isActive = !isFinished && c.kind === "hole" ? c.hole.hole_number === activeHole : false;

                      const cell = (v: any) => (
                        <div
                          className={`h-7 flex items-center justify-center text-[10px] border-r border-emerald-900/60 ${
                            isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/40 text-emerald-100/80"
                          }`}
                        >
                          {v ?? ""}
                        </div>
                      );

                      if (c.kind === "hole") {
                        return (
                          <div key={`meta-hole-${c.hole.hole_number}`} className="border-b border-emerald-900/60">
                            {cell(c.hole.hole_number)}
                            {cell(c.hole.par)}
                            {cell(c.hole.yardage)}
                            {cell(c.hole.stroke_index)}
                          </div>
                        );
                      }

                      const label: SumKind =
                        c.kind === "outMid" ? "OUT" : c.kind === "outEnd" ? "OUT" : c.kind === "inEnd" ? "IN" : "TOT";

                      const par = sumPar(label);
                      const yds = sumYds(label);

                      return (
                        <div key={`meta-sum-${c.kind}-${idx}`} className="border-b border-emerald-900/60">
                          {cell(label)}
                          {cell(par ?? "–")}
                          {cell(yds ?? "–")}
                          {cell("")}
                        </div>
                      );
                    })}
                  </div>

                  <div className="divide-y divide-emerald-900/60">
                    {participants.map((p) => {
                      const name = getParticipantLabel(p);
                      const avatarUrl = getParticipantAvatar(p);
                      const t = totals[p.id];
                      const hi = typeof p.handicap_index === "number" ? p.handicap_index.toFixed(1) : "–";
                      const ch = typeof p.course_handicap === "number" ? String(p.course_handicap) : "–";

                      return (
                        <div key={p.id} className="grid" style={{ gridTemplateColumns: landscapeCols }}>
                          <div className="bg-[#0b3b21]/60">
                            <div className="h-10 px-2.5 flex items-center gap-2 min-w-0">
                              <Avatar className="h-6 w-6 border border-emerald-200/70 shrink-0">
                                {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                                <AvatarFallback className="text-[9px]">{initialsFrom(name)}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="text-[12px] font-semibold text-emerald-50 truncate">{name}</div>
                                <div className="text-[10px] text-emerald-100/60 leading-none">
                                  HI {hi} · CH {ch}
                                </div>
                              </div>
                            </div>
                          </div>

                          {landscapePlan.map((c, idx) => {
                            if (c.kind === "hole") {
                              const h = c.hole;
                              const s = displayedScoreFor(p.id, h.hole_number);
                              const key = `${p.id}:${h.hole_number}`;
                              const isActive = !isFinished && h.hole_number === activeHole;
                              const disabled = !canScore || isFinished;

                              const recv =
                                scoreView === "net"
                                  ? strokesReceivedOnHole(p.course_handicap ?? null, h.stroke_index ?? null)
                                  : 0;

                              return (
                                <button
                                  key={`cell-hole-${idx}-${key}`}
                                  className={`h-10 border-r border-emerald-900/60 flex flex-col items-center justify-center font-semibold tabular-nums text-[13px]
                                    ${isActive ? "bg-[#042713] text-[#f5e6b0]" : "bg-[#0b3b21]/20 text-emerald-50"}
                                    ${disabled ? "opacity-80 cursor-default" : "hover:bg-emerald-900/20"}
                                  `}
                                  onClick={() => openEntry(p.id, h.hole_number)}
                                  disabled={disabled}
                                >
                                  <div className="leading-none">{savingKey === key ? "…" : s ?? "–"}</div>
                                  {scoreView === "net" && recv > 0 ? (
                                    <div className="mt-1 leading-none">
                                      <StrokeDots count={recv} />
                                    </div>
                                  ) : (
                                    <div className="h-[6px]" />
                                  )}
                                </button>
                              );
                            }

                            const value =
                              c.kind === "outMid" || c.kind === "outEnd"
                                ? t?.out ?? 0
                                : c.kind === "inEnd"
                                ? t?.in ?? 0
                                : t?.total ?? 0;

                            const label: SumKind =
                              c.kind === "outMid" || c.kind === "outEnd"
                                ? "OUT"
                                : c.kind === "inEnd"
                                ? "IN"
                                : "TOT";

                            const par = sumPar(label);
                            const toPar = typeof par === "number" ? value - par : null;

                            const isTot = c.kind === "totEnd";

                            return (
                              <div
                                key={`cell-sum-${p.id}-${idx}`}
                                className={`h-10 border-r border-emerald-900/60 flex flex-col items-center justify-center font-bold tabular-nums text-[12px]
                                  ${isTot ? "bg-[#f5e6b0] text-[#042713]" : "bg-[#0b3b21]/30 text-emerald-50"}
                                `}
                              >
                                <div className="leading-none">{value}</div>
                                <div className={`text-[10px] font-semibold leading-none ${isTot ? "text-[#042713]/70" : "text-emerald-100/70"}`}>
                                  {toPar != null ? formatToPar(toPar) : ""}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        ) : null}

        {finishOpen ? (
          <ConfirmSheet
            title="Finish round?"
            subtitle="This will lock scoring for everyone."
            confirmLabel={finishing ? "Finishing…" : "Finish round"}
            confirmDisabled={finishing}
            onConfirm={finishRound}
            onClose={() => setFinishOpen(false)}
          />
        ) : null}

        {!isFinished && entryOpen && entryPid && entryHole ? (
          <ScoreEntrySheet
            participants={participants}
            holes={holesList}
            pid={entryPid}
            holeNumber={entryHole}
            mode={entryMode}
            customVal={customVal}
            setMode={setEntryMode}
            setCustomVal={setCustomVal}
            canScore={canScore}
            isFinished={isFinished}
            scoreFor={scoreFor}
            savingKey={savingKey}
            onClose={closeEntry}
            onSubmit={submitAndAdvance}
            getParticipantLabel={getParticipantLabel}
            getParticipantAvatar={getParticipantAvatar}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Confirm Sheet ---------------- */

function ConfirmSheet(props: {
  title: string;
  subtitle?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { title, subtitle, confirmLabel, confirmDisabled, onConfirm, onClose } = props;

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-emerald-900/60">
            <div className="text-sm font-semibold text-emerald-50">{title}</div>
            {subtitle ? <div className="text-[11px] text-emerald-100/70 mt-1">{subtitle}</div> : null}
          </div>

          <div className="p-4 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
              onClick={onClose}
              disabled={!!confirmDisabled}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c] disabled:opacity-60"
              onClick={onConfirm}
              disabled={!!confirmDisabled}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Score Entry Sheet ---------------- */

function ScoreEntrySheet(props: {
  participants: Participant[];
  holes: Hole[];
  pid: string;
  holeNumber: number;
  mode: "quick" | "custom";
  customVal: string;
  setMode: (m: "quick" | "custom") => void;
  setCustomVal: (v: string) => void;
  canScore: boolean;
  isFinished: boolean;
  scoreFor: (pid: string, hole: number) => number | null;
  savingKey: string | null;
  onClose: () => void;
  onSubmit: (strokes: number | null) => Promise<void>;
  getParticipantLabel: (p: Participant) => string;
  getParticipantAvatar: (p: Participant) => string | null;
}) {
  const {
    participants,
    holes,
    pid,
    holeNumber,
    mode,
    customVal,
    setMode,
    setCustomVal,
    canScore,
    isFinished,
    scoreFor,
    savingKey,
    onClose,
    onSubmit,
    getParticipantLabel,
    getParticipantAvatar,
  } = props;

  const p = participants.find((x) => x.id === pid)!;
  const name = getParticipantLabel(p);
  const avatarUrl = getParticipantAvatar(p);
  const holeMeta = holes.find((h) => h.hole_number === holeNumber);

  const current = scoreFor(pid, holeNumber);
  const disabled = !canScore || isFinished;
  const busy = savingKey === `${pid}:${holeNumber}`;

  const missingCount = useMemo(() => {
    let missing = 0;
    for (const pp of participants) {
      const s = scoreFor(pp.id, holeNumber);
      if (typeof s !== "number") missing += 1;
    }
    return missing;
  }, [participants, holeNumber, scoreFor]);

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />

      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden">
          <div className="p-3 border-b border-emerald-900/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar className="h-10 w-10 border border-emerald-200/70">
                {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
                <AvatarFallback>{initialsFrom(name)}</AvatarFallback>
              </Avatar>

              <div className="min-w-0">
                <div className="text-sm font-semibold text-emerald-50 truncate">Enter score for {name}</div>
                <div className="text-[11px] text-emerald-100/70">
                  Hole {holeNumber} · Par {holeMeta?.par ?? "–"} · SI {holeMeta?.stroke_index ?? "–"}
                  
                </div>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl border border-emerald-900/70 bg-[#042713] text-emerald-50 hover:bg-emerald-900/20"
              onClick={onClose}
            >
              Close
            </Button>
          </div>

          <div className="p-3">
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/25 p-3 flex items-center justify-between">
              <div className="text-[11px] text-emerald-100/70">Current</div>
              <div className="text-4xl font-extrabold text-[#f5e6b0] tabular-nums">{busy ? "…" : current ?? "–"}</div>
              <button
                className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/35 px-3 py-2 text-[11px] text-emerald-100/80 hover:bg-emerald-900/20 disabled:opacity-40"
                disabled={disabled || busy}
                onClick={() => onSubmit(null)}
              >
                Clear
              </button>
            </div>

            {mode === "quick" ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    className="h-11 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 text-lg font-semibold hover:bg-emerald-900/25 disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => onSubmit(n)}
                  >
                    {n}
                  </button>
                ))}

                <button
                  className="h-11 rounded-2xl border border-emerald-900/70 bg-[#f5e6b0] text-[#042713] text-lg font-bold hover:bg-[#e9d79c] disabled:opacity-40"
                  disabled={disabled || busy}
                  onClick={() => {
                    setMode("custom");
                    setCustomVal("10");
                  }}
                >
                  10+
                </button>

                <button
                  className="h-11 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-100/80 text-sm hover:bg-emerald-900/25 disabled:opacity-40 col-span-2"
                  disabled={disabled || busy}
                  onClick={onClose}
                >
                  Done for now
                </button>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/30 p-3">
                <div className="text-xs text-emerald-100/70 mb-2">Enter any score</div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={customVal}
                  onChange={(e) => setCustomVal(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full h-11 rounded-2xl bg-[#042713] border border-emerald-900/70 px-4 text-emerald-50 text-lg font-semibold outline-none"
                  placeholder="10"
                />

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20 disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => setMode("quick")}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c] disabled:opacity-40"
                    disabled={disabled || busy}
                    onClick={() => {
                      const n = parseInt(customVal || "", 10);
                      if (!Number.isFinite(n)) return;
                      onSubmit(n);
                    }}
                  >
                    Set score
                  </Button>
                </div>
              </div>
            )}

            {isFinished ? (
              <div className="mt-3 text-[11px] text-amber-200/80">This round is finished. Editing is disabled.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

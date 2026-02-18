"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

import { finishRound as finishRoundApi } from "@/lib/rounds/api";
import { useRoundDetail } from "@/lib/rounds/hooks/useRoundDetail";
import type { Participant, Hole, HoleState } from "@/lib/rounds/hooks/useRoundDetail";
import { strokesReceivedOnHole, netFromGross } from "@/lib/rounds/handicapUtils";
import { computeFormatDisplay, type FormatScoreView, type FormatDisplayData } from "@/lib/rounds/formatScoring";

import ConfirmSheet from "@/components/round/ConfirmSheet";
import ScoreEntrySheet from "@/components/round/ScoreEntrySheet";
import FinalResultsPanel from "@/components/round/FinalResultsPanel";
import ScorecardPortrait from "@/components/round/ScorecardPortrait";
import ScorecardLandscape from "@/components/round/ScorecardLandscape";

type ProfileEmbed = { name: string | null; email: string | null; avatar_url: string | null };
type Score = { participant_id: string; hole_number: number; strokes: number | null; created_at: string };

function initialsFrom(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase().slice(0, 2);
}

function pickProfile(p: Participant): ProfileEmbed | null {
  const prof = (p as any).profiles ?? null;
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
  isHoleCompleteForPlayer: (pid: string, hole: number) => boolean
) {
  if (!holesList.length) return 1;

  for (const h of holesList) {
    const allDone = participants.every((p) => isHoleCompleteForPlayer(p.id, h.hole_number));
    if (!allDone) return h.hole_number;
  }

  return holesList[holesList.length - 1].hole_number;
}

function findNextUnscoredPlayerForHole(
  participants: Participant[],
  startParticipantId: string,
  holeNumber: number,
  isHoleCompleteForPlayer: (pid: string, hole: number) => boolean
): string | null {
  if (!participants.length) return null;

  const startIdx = Math.max(0, participants.findIndex((p) => p.id === startParticipantId));

  for (let step = 1; step <= participants.length; step++) {
    const idx = (startIdx + step) % participants.length;
    const pid = participants[idx].id;
    if (!isHoleCompleteForPlayer(pid, holeNumber)) return pid;
  }

  return null;
}

function countMissingForHole(
  participants: Participant[],
  holeNumber: number,
  isHoleCompleteForPlayer: (pid: string, hole: number) => boolean
) {
  let missing = 0;
  for (const p of participants) {
    if (!isHoleCompleteForPlayer(p.id, holeNumber)) missing += 1;
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

  const {
    loading,
    err,
    setErr,
    meId,
    roundName,
    status,
    setStatus,
    courseLabel,
    playedOnIso,
    formatType,
    formatConfig,
    participants,
    teams,
    teeSnapshotId,
    holes,
    scoresByKey,
    setScoresByKey,
    holeStatesByKey,
    canScore,
  } = useRoundDetail(roundId);

  const [scoreView, setScoreView] = useState<FormatScoreView>("gross");

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

  const holeStateFor = useCallback(
    (participantId: string, holeNumber: number): HoleState =>
      (holeStatesByKey?.[`${participantId}:${holeNumber}`] as HoleState | undefined) ?? "not_started",
    [holeStatesByKey]
  );

  const isHoleCompleteForPlayer = useCallback(
    (participantId: string, holeNumber: number) => {
      const st = holeStateFor(participantId, holeNumber);
      return st === "completed" || st === "picked_up";
    },
    [holeStateFor]
  );

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

  const formatDisplay = useMemo<FormatDisplayData | null>(() => {
    return computeFormatDisplay(formatType, formatConfig, participants, holesList, scoresByKey, holeStatesByKey, teams);
  }, [formatType, formatConfig, participants, holesList, scoresByKey, holeStatesByKey, teams]);

  // Displayed score:
  // - not_started => null (render blank)
  // - picked_up   => "PU"
  // - completed   => number (gross or net) or format value
  const displayedScoreFor = useCallback(
    (participantId: string, holeNumber: number): string | number | null => {
      if (scoreView === "format" && formatDisplay) {
        const r = formatDisplay.holeResults[`${participantId}:${holeNumber}`];
        return r?.displayValue ?? null;
      }

      const st = holeStateFor(participantId, holeNumber);
      if (st === "not_started") return null;
      if (st === "picked_up") return "PU";

      const gross = scoreFor(participantId, holeNumber);
      if (typeof gross !== "number") return null;
      if (scoreView === "gross") return gross;

      const p = participants.find((x) => x.id === participantId);
      const h = holesList.find((x) => x.hole_number === holeNumber);

      const recv = strokesReceivedOnHole(p?.course_handicap ?? null, h?.stroke_index ?? null);
      return netFromGross(gross, recv);
    },
    [holeStateFor, scoreFor, scoreView, participants, holesList, formatDisplay]
  );

  const totals = useMemo(() => {
    // Format view uses its own summaries
    if (scoreView === "format" && formatDisplay) {
      const byId: Record<string, { out: number; in: number; total: number }> = {};
      for (const s of formatDisplay.summaries) {
        byId[s.participantId] = {
          out: typeof s.out === "number" ? s.out : 0,
          in: typeof s.inn === "number" ? s.inn : 0,
          total: typeof s.total === "number" ? s.total : 0,
        };
      }
      // Fill missing participants with zeros
      for (const p of participants) {
        if (!byId[p.id]) byId[p.id] = { out: 0, in: 0, total: 0 };
      }
      return byId;
    }

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
  }, [participants, holesList, displayedScoreFor, scoreView, formatDisplay]);

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
    if (formatDisplay?.higherIsBetter) {
      rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    } else {
      rows.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
    }
    return rows;
  }, [participants, totals, toParTotalByParticipant, getParticipantLabel, getParticipantAvatar, formatDisplay]);

  const winner = finalRows[0] ?? null;

  useEffect(() => {
    if (isFinished) return;
    if (!participants.length || !holesList.length) return;
    const next = computeNextIncompleteHole(holesList, participants, isHoleCompleteForPlayer);
    setActiveHole((prev) => (prev === next ? prev : next));
  }, [participants, holesList, isHoleCompleteForPlayer, isFinished]);

  async function setHoleState(participantId: string, holeNumber: number, nextState: HoleState) {
    if (!canScore || isFinished) return false;

    const key = `${participantId}:${holeNumber}`;
    setSavingKey(key);
    setErr(null);

    try {
      const { error } = await supabase
        .from("round_hole_states")
        .upsert(
          { round_id: roundId, participant_id: participantId, hole_number: holeNumber, status: nextState },
          { onConflict: "participant_id,hole_number" }
        );
      if (error) throw error;

      return true;
    } catch (e: any) {
      setErr(e?.message || "Failed to save hole status");
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  // Only clears score event (does NOT touch hole state)
  async function clearScoreEvent(participantId: string, holeNumber: number) {
    if (!meId) return false;
    if (!canScore || isFinished) return false;

    const key = `${participantId}:${holeNumber}`;
    setSavingKey(key);
    setErr(null);

    try {
      const { error } = await supabase.from("round_score_events").insert({
        round_id: roundId,
        participant_id: participantId,
        hole_number: holeNumber,
        strokes: null,
        entered_by: meId,
      });
      if (error) throw error;

      setScoresByKey((prev) => ({
        ...prev,
        [key]: {
          participant_id: participantId,
          hole_number: holeNumber,
          strokes: null,
          created_at: new Date().toISOString(),
        } as Score,
      }));

      return true;
    } catch (e: any) {
      setErr(e?.message || "Failed to clear score");
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  // We keep your event-sourced scoring.
  // Additionally, when a numeric score is entered, mark the hole as completed.
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
        } as Score,
      }));

      // If user entered a number, the hole is completed.
      // If strokes is null, we do NOT force state (use explicit PU/Not Started buttons).
      if (typeof strokes === "number") {
        await setHoleState(participantId, holeNumber, "completed");
      }

      return true;
    } catch (e: any) {
      setErr(e?.message || "Failed to save score");
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  async function markPickedUp(participantId: string, holeNumber: number) {
    const ok = await setHoleState(participantId, holeNumber, "picked_up");
    if (!ok) return;
    await clearScoreEvent(participantId, holeNumber);
  }

  async function markNotStarted(participantId: string, holeNumber: number) {
    const ok = await setHoleState(participantId, holeNumber, "not_started");
    if (!ok) return;
    await clearScoreEvent(participantId, holeNumber);
  }

  async function finishRound() {
    if (!canScore || isFinished) return;
    setErr(null);
    setFinishing(true);
    try {
      await finishRoundApi(roundId);
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

  // After completing an action for pid on hole, advance to next unscored player or close.
  // Excludes pid from the "missing" check since their state update may not be reflected yet.
  function advanceAfterCompletion(pid: string, hole: number) {
    const othersMissing = participants.filter((p) => p.id !== pid && !isHoleCompleteForPlayer(p.id, hole)).length;
    if (othersMissing === 0) { closeEntry(); return; }
    const nextPid = findNextUnscoredPlayerForHole(participants, pid, hole, isHoleCompleteForPlayer);
    if (nextPid) { setEntryPid(nextPid); setEntryMode("quick"); setCustomVal("10"); } else { closeEntry(); }
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
    const pid = entryPid;
    const hole = entryHole;
    const ok = await setScore(pid, hole, strokes);
    if (!ok) return;
    advanceAfterCompletion(pid, hole);
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

  const subtitle = `${status}${playedOnLabel ? ` · ${playedOnLabel}` : ""}`;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-none space-y-2">
        <header className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30 shrink-0"
            onClick={() => {
              const sp = new URLSearchParams(window.location.search);
              const from = sp.get("from");
              if (from === "history") {
                router.push("/history");
              } else if (from === "social") {
                router.push("/social");
              } else if (from === "player") {
                router.back();
              } else {
                router.push("/round");
              }
            }}
          >
            ← Back
          </Button>

          {isPortrait ? (
            <>
              <div className="flex-1 min-w-0 px-1">
                <div className="text-center">
                  <div className="text-[15px] font-semibold tracking-wide text-[#f5e6b0] truncate">{roundName}</div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">{subtitle}</div>
                </div>
                <div className="mt-1 flex justify-center">
                  <div className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/50 p-1 flex">
                    {(["gross", "net", ...(formatDisplay ? ["format"] : [])] as FormatScoreView[]).map((v) => (
                      <button
                        key={v}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg ${
                          scoreView === v ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                        }`}
                        onClick={() => setScoreView(v)}
                      >
                        {v === "format" ? formatDisplay!.tabLabel : v === "gross" ? "Gross" : "Net"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="shrink-0">
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
            </>
          ) : (
            <>
              <div className="text-center flex-1 px-1 min-w-0">
                <div className="text-[15px] font-semibold tracking-wide text-[#f5e6b0] truncate">{roundName}</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">{subtitle}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {canFinish ? (
                  <Button
                    size="sm"
                    className="rounded-xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c] px-3"
                    onClick={() => setFinishOpen(true)}
                  >
                    Finish
                  </Button>
                ) : null}
                <div className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/50 p-1 flex">
                  {(["gross", "net", ...(formatDisplay ? ["format"] : [])] as FormatScoreView[]).map((v) => (
                    <button
                      key={v}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg ${
                        scoreView === v ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                      }`}
                      onClick={() => setScoreView(v)}
                    >
                      {v === "format" ? formatDisplay!.tabLabel : v === "gross" ? "Gross" : "Net"}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
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

        {!needsSetup && isFinished && winner ? <FinalResultsPanel winner={winner} finalRows={finalRows} formatDisplay={formatDisplay} /> : null}

        {!needsSetup ? (
          isPortrait ? (
            <ScorecardPortrait
              participants={participants}
              holesList={holesList}
              portraitCols={portraitCols}
              compactPlayers={compactPlayers}
              canScore={canScore}
              isFinished={isFinished}
              activeHole={activeHole}
              savingKey={savingKey}
              scoreView={scoreView}
              formatDisplay={formatDisplay}
              metaSums={metaSums}
              totals={totals}
              displayedScoreFor={displayedScoreFor}
              onOpenEntry={openEntry}
              getParticipantLabel={getParticipantLabel}
              getParticipantAvatar={getParticipantAvatar}
            />
          ) : (
            <ScorecardLandscape
              participants={participants}
              holesList={holesList}
              landscapePlan={landscapePlan}
              landscapeCols={landscapeCols}
              canScore={canScore}
              isFinished={isFinished}
              activeHole={activeHole}
              savingKey={savingKey}
              scoreView={scoreView}
              formatDisplay={formatDisplay}
              metaSums={metaSums}
              totals={totals}
              displayedScoreFor={displayedScoreFor}
              onOpenEntry={openEntry}
              getParticipantLabel={getParticipantLabel}
              getParticipantAvatar={getParticipantAvatar}
            />
          )
        ) : null}

        {finishOpen ? (
          <ConfirmSheet
            title="Finish round?"
            subtitle="This will lock scoring for everyone. Any incomplete holes will be saved as Not Started (—)."
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
            holeState={holeStateFor(entryPid, entryHole)}
            isPortrait={isPortrait}
            onSetPickedUp={async () => {
              if (!entryPid || entryHole == null) return;
              const pid = entryPid; const hole = entryHole;
              await markPickedUp(pid, hole);
              advanceAfterCompletion(pid, hole);
            }}
            onSetNotStarted={async () => {
              if (!entryPid || entryHole == null) return;
              const pid = entryPid; const hole = entryHole;
              await markNotStarted(pid, hole);
              advanceAfterCompletion(pid, hole);
            }}
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

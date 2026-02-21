"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

import { finishRound as finishRoundApi } from "@/lib/rounds/api";
import { useRoundDetail } from "@/lib/rounds/hooks/useRoundDetail";
import type { Participant, Hole, HoleState } from "@/lib/rounds/hooks/useRoundDetail";
import { strokesReceivedOnHole, netFromGross } from "@/lib/rounds/handicapUtils";
import { computeFormatDisplay, computeSideGameDisplays, isFormatView, formatViewIndex, type FormatScoreView, type FormatDisplayData } from "@/lib/rounds/formatScoring";
import { useOrientationLock } from "@/lib/useOrientationLock";

import { Menu } from "lucide-react";
import ConfirmSheet from "@/components/round/ConfirmSheet";
import ScoreEntrySheet from "@/components/round/ScoreEntrySheet";
import FinalResultsPanel from "@/components/round/FinalResultsPanel";
import ScorecardPortrait from "@/components/round/ScorecardPortrait";
import ScorecardLandscape from "@/components/round/ScorecardLandscape";
import RoundMenuSheet from "@/components/round/RoundMenuSheet";

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

/** WHS net double bogey penalty for a picked-up hole: par + 2 + strokes received */
function puPenaltyGross(par: number, courseHcp: number | null, si: number | null): number {
  return par + 2 + strokesReceivedOnHole(courseHcp, si);
}

/** Compute set of participant IDs whose rounds don't meet WHS minimum holes */
function getNotAcceptedParticipants(
  participants: Participant[],
  holesList: Hole[],
  holeStatesByKey: Record<string, string>
): { ids: Set<string>; names: string[] } {
  const holeCount = holesList.length || 18;
  const minRequired = holeCount <= 9 ? 7 : 14;
  const ids = new Set<string>();
  const names: string[] = [];

  for (const p of participants) {
    let holesStarted = 0;
    for (const h of holesList) {
      const st = holeStatesByKey[`${p.id}:${h.hole_number}`] ?? "not_started";
      if (st !== "not_started") holesStarted++;
    }
    if (holesStarted < minRequired) {
      ids.add(p.id);
      names.push(p.display_name || "A player");
    }
  }

  return { ids, names };
}

type FinalRow = {
  participantId: string;
  name: string;
  avatarUrl: string | null;
  total: number | string;
  out: number | string;
  in: number | string;
  toPar: number | null;
};

function buildFinalRows(
  participants: Participant[],
  totals: Record<string, { out: number | string; in: number | string; total: number | string }>,
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
      total: typeof t.total === "string" ? t.total : (stableNumber(t.total) ?? 0),
      out: typeof t.out === "string" ? t.out : (stableNumber(t.out) ?? 0),
      in: typeof t.in === "string" ? t.in : (stableNumber(t.in) ?? 0),
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

type RoundDetailClientProps = {
  roundId: string;
  initialSnapshot?: any;
};

export default function RoundDetailClient({ roundId, initialSnapshot }: RoundDetailClientProps) {
  const router = useRouter();

  useOrientationLock("any");
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
    sideGames,
    participants,
    teams,
    teeSnapshotId,
    holes,
    scoresByKey,
    setScoresByKey,
    holeStatesByKey,
    canScore,
  } = useRoundDetail(roundId, initialSnapshot);

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
  const [menuOpen, setMenuOpen] = useState(false);

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

  const formatDisplays = useMemo<FormatDisplayData[]>(() => {
    const main = computeFormatDisplay(formatType, formatConfig, participants, holesList, scoresByKey, holeStatesByKey, teams, getParticipantLabel);
    const side = computeSideGameDisplays(sideGames, participants, holesList, scoresByKey, holeStatesByKey);
    return [...main, ...side];
  }, [formatType, formatConfig, sideGames, participants, holesList, scoresByKey, holeStatesByKey, teams, getParticipantLabel]);

  const activeFormatDisplay = useMemo<FormatDisplayData | null>(() => {
    if (!isFormatView(scoreView)) return null;
    const idx = formatViewIndex(scoreView);
    return formatDisplays[idx] ?? null;
  }, [scoreView, formatDisplays]);

  // Guard: reset scoreView if selected format index is out of bounds
  useEffect(() => {
    if (isFormatView(scoreView) && formatViewIndex(scoreView) >= formatDisplays.length) {
      setScoreView("gross");
    }
  }, [scoreView, formatDisplays]);

  // Displayed score:
  // - not_started => null (render blank)
  // - picked_up   => "PU"
  // - completed   => number (gross or net) or format value
  const displayedScoreFor = useCallback(
    (participantId: string, holeNumber: number): string | number | null => {
      if (isFormatView(scoreView) && activeFormatDisplay) {
        const r = activeFormatDisplay.holeResults[`${participantId}:${holeNumber}`];
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
    [holeStateFor, scoreFor, scoreView, participants, holesList, activeFormatDisplay]
  );

  // Numeric scoring value for totals (includes PU penalty, unlike displayedScoreFor which returns "PU")
  const scoringValueFor = useCallback(
    (participantId: string, holeNumber: number): number | null => {
      if (isFormatView(scoreView)) return null;

      const st = holeStateFor(participantId, holeNumber);
      if (st === "not_started") return null;

      if (st === "picked_up") {
        const h = holesList.find((x) => x.hole_number === holeNumber);
        if (!h?.par) return null;
        const p = participants.find((x) => x.id === participantId);
        const courseHcp = p?.course_handicap ?? null;
        if (scoreView === "gross") return puPenaltyGross(h.par, courseHcp, h.stroke_index);
        return h.par + 2; // net: strokes received cancel out
      }

      const gross = scoreFor(participantId, holeNumber);
      if (typeof gross !== "number") return null;
      if (scoreView === "gross") return gross;

      const p = participants.find((x) => x.id === participantId);
      const h = holesList.find((x) => x.hole_number === holeNumber);
      const recv = strokesReceivedOnHole(p?.course_handicap ?? null, h?.stroke_index ?? null);
      return netFromGross(gross, recv);
    },
    [holeStateFor, scoreFor, scoreView, participants, holesList]
  );

  const totals = useMemo(() => {
    // Format view uses its own summaries (may include string values like "2 UP")
    if (isFormatView(scoreView) && activeFormatDisplay) {
      const byId: Record<string, { out: number | string; in: number | string; total: number | string }> = {};
      for (const s of activeFormatDisplay.summaries) {
        byId[s.participantId] = {
          out: s.out,
          in: s.inn,
          total: s.total,
        };
      }
      // Fill missing participants with dash placeholders
      for (const p of participants) {
        if (!byId[p.id]) byId[p.id] = { out: "–", in: "–", total: "–" };
      }
      return byId;
    }

    const byParticipant: Record<string, { out: number | string; in: number | string; total: number | string }> = {};
    for (const p of participants) {
      let out = 0,
        inn = 0,
        total = 0;

      for (const h of holesList) {
        const s = scoringValueFor(p.id, h.hole_number);
        if (typeof s === "number") {
          total += s;
          if (h.hole_number <= 9) out += s;
          else inn += s;
        }
      }

      byParticipant[p.id] = { out, in: inn, total };
    }
    return byParticipant;
  }, [participants, holesList, scoringValueFor, scoreView, activeFormatDisplay]);

  const toParTotalByParticipant = useMemo(() => {
    const map: Record<string, number | null> = {};
    const parTot = metaSums.parTot;
    for (const p of participants) {
      if (typeof parTot !== "number") {
        map[p.id] = null;
        continue;
      }
      const t = totals[p.id]?.total ?? 0;
      map[p.id] = typeof t === "number" ? t - parTot : null;
    }
    return map;
  }, [participants, totals, metaSums.parTot]);

  // Always-available gross totals for leaderboard (independent of scoreView)
  const grossTotals = useMemo(() => {
    const byPid: Record<string, { out: number; in: number; total: number }> = {};
    for (const p of participants) {
      let out = 0, inn = 0, total = 0;
      const courseHcp = typeof p.course_handicap === "number" ? p.course_handicap : null;
      for (const h of holesList) {
        const st = holeStatesByKey[`${p.id}:${h.hole_number}`] ?? "not_started";
        if (st === "picked_up" && h.par) {
          const penalty = puPenaltyGross(h.par, courseHcp, h.stroke_index);
          total += penalty;
          if (h.hole_number <= 9) out += penalty; else inn += penalty;
        } else {
          const s = scoreFor(p.id, h.hole_number);
          if (typeof s === "number") {
            total += s;
            if (h.hole_number <= 9) out += s; else inn += s;
          }
        }
      }
      byPid[p.id] = { out, in: inn, total };
    }
    return byPid;
  }, [participants, holesList, scoreFor, holeStatesByKey]);

  // Always-available net totals for leaderboard
  const netTotals = useMemo(() => {
    const byPid: Record<string, { out: number; in: number; total: number }> = {};
    for (const p of participants) {
      let out = 0, inn = 0, total = 0;
      const hcp = typeof p.course_handicap === "number" ? p.course_handicap : 0;
      for (const h of holesList) {
        const st = holeStatesByKey[`${p.id}:${h.hole_number}`] ?? "not_started";
        if (st === "picked_up" && h.par) {
          const net = h.par + 2; // PU net penalty (strokes received cancel out)
          total += net;
          if (h.hole_number <= 9) out += net; else inn += net;
        } else {
          const gross = scoreFor(p.id, h.hole_number);
          if (typeof gross === "number" && h.par) {
            const recv = strokesReceivedOnHole(hcp, h.stroke_index);
            const net = netFromGross(gross, recv);
            total += net;
            if (h.hole_number <= 9) out += net;
            else inn += net;
          }
        }
      }
      byPid[p.id] = { out, in: inn, total };
    }
    return byPid;
  }, [participants, holesList, scoreFor, holeStatesByKey]);

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
    const primaryFormat = formatDisplays[0] ?? null;
    const hasStringTotals = rows.some((r) => typeof r.total === "string");
    if (hasStringTotals) {
      // Matchplay: winners (W ...) sort before losers (L ...), then AS
      rows.sort((a, b) => {
        const aStr = String(a.total);
        const bStr = String(b.total);
        const aWin = aStr.startsWith("W") ? 0 : aStr.startsWith("L") ? 2 : 1;
        const bWin = bStr.startsWith("W") ? 0 : bStr.startsWith("L") ? 2 : 1;
        return aWin - bWin || a.name.localeCompare(b.name);
      });
    } else if (primaryFormat?.higherIsBetter) {
      rows.sort((a, b) => (b.total as number) - (a.total as number) || a.name.localeCompare(b.name));
    } else {
      rows.sort((a, b) => (a.total as number) - (b.total as number) || a.name.localeCompare(b.name));
    }
    return rows;
  }, [participants, totals, toParTotalByParticipant, getParticipantLabel, getParticipantAvatar, formatDisplays]);

  const winner = finalRows[0] ?? null;

  const { notAcceptedIds, finishWarning } = useMemo(() => {
    const { ids, names } = getNotAcceptedParticipants(participants, holesList, holeStatesByKey);
    if (names.length === 0) return { notAcceptedIds: ids, finishWarning: null as string | null };
    const holeCount = holesList.length || 18;
    const minRequired = holeCount <= 9 ? 7 : 14;
    const warning = names.length === 1
      ? `${names[0]} has fewer than ${minRequired} holes started. Their round will not count toward handicap.`
      : `${names.join(", ")} have fewer than ${minRequired} holes started. Their rounds will not count toward handicap.`;
    return { notAcceptedIds: ids, finishWarning: warning };
  }, [participants, holesList, holeStatesByKey]);

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

  // Scramble mode: show one column per team instead of one per player.
  // Each team's scores map to the first team member's participant ID.
  const isScramble = formatType === "scramble";
  const scrambleTeamParticipants = useMemo<Participant[]>(() => {
    if (!isScramble || !teams.length) return participants;
    // Build a virtual participant per team, using first member's ID
    return teams
      .map((t) => {
        const members = participants.filter((p) => p.team_id === t.id);
        const first = members[0];
        if (!first) return null;
        return {
          ...first,
          display_name: t.name, // Show team name instead of player name
        } as Participant;
      })
      .filter(Boolean) as Participant[];
  }, [isScramble, teams, participants]);

  const scorecardParticipants = isScramble ? scrambleTeamParticipants : participants;

  // When on a format tab with filtered participants, show only those
  const visibleParticipants = useMemo(() => {
    if (activeFormatDisplay?.filteredParticipantIds) {
      const ids = new Set(activeFormatDisplay.filteredParticipantIds);
      return scorecardParticipants.filter((p) => ids.has(p.id));
    }
    return scorecardParticipants;
  }, [scorecardParticipants, activeFormatDisplay]);

  const scrambleGetLabel = useCallback(
    (p: Participant) => {
      if (isScramble) return p.display_name || "Team";
      return getParticipantLabel(p);
    },
    [isScramble, getParticipantLabel]
  );

  const scrambleGetAvatar = useCallback(
    (p: Participant) => {
      if (isScramble) return null; // No avatar for teams
      return getParticipantAvatar(p);
    },
    [isScramble, getParticipantAvatar]
  );

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

  const compactPlayers = visibleParticipants.length >= 6;
  const portraitCols = `30px 32px 38px 30px repeat(${visibleParticipants.length}, minmax(0, 1fr))`;
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
                  <div className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/50 p-1 flex items-center overflow-hidden max-w-full">
                    <button
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 ${
                        scoreView === "gross" ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                      }`}
                      onClick={() => setScoreView("gross")}
                    >
                      Gross
                    </button>
                    <button
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 ${
                        scoreView === "net" ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                      }`}
                      onClick={() => setScoreView("net")}
                    >
                      Net
                    </button>
                    {formatDisplays.length > 0 && (
                      <>
                        <div className="w-px h-5 bg-emerald-900/50 mx-0.5 shrink-0" />
                        <div className="flex overflow-x-auto min-w-0" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                          {formatDisplays.map((fd, i) => (
                            <button
                              key={i}
                              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 whitespace-nowrap ${
                                scoreView === `format:${i}` ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                              }`}
                              onClick={() => setScoreView(`format:${i}` as FormatScoreView)}
                            >
                              {fd.tabLabel}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2 text-emerald-100 hover:bg-emerald-900/30"
                  onClick={() => setMenuOpen(true)}
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-center flex-1 px-1 min-w-0">
                <div className="text-[15px] font-semibold tracking-wide text-[#f5e6b0] truncate">{roundName}</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">{subtitle}</div>
              </div>
              <div className="flex flex-col items-end gap-1 min-w-0 overflow-hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2 text-emerald-100 hover:bg-emerald-900/30"
                  onClick={() => setMenuOpen(true)}
                >
                  <Menu className="h-5 w-5" />
                </Button>
                <div className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/50 p-1 flex items-center overflow-hidden max-w-full">
                  <button
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 ${
                      scoreView === "gross" ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                    }`}
                    onClick={() => setScoreView("gross")}
                  >
                    Gross
                  </button>
                  <button
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 ${
                      scoreView === "net" ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                    }`}
                    onClick={() => setScoreView("net")}
                  >
                    Net
                  </button>
                  {formatDisplays.length > 0 && (
                    <>
                      <div className="w-px h-5 bg-emerald-900/50 mx-0.5 shrink-0" />
                      <div className="flex overflow-x-auto min-w-0" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                        {formatDisplays.map((fd, i) => (
                          <button
                            key={i}
                            className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 whitespace-nowrap ${
                              scoreView === `format:${i}` ? "bg-[#f5e6b0] text-[#042713]" : "text-emerald-100/80 hover:bg-emerald-900/20"
                            }`}
                            onClick={() => setScoreView(`format:${i}` as FormatScoreView)}
                          >
                            {fd.tabLabel}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
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

        {!needsSetup && isFinished && winner ? <FinalResultsPanel winner={winner} finalRows={finalRows} formatDisplay={formatDisplays[0] ?? null} notAcceptedIds={notAcceptedIds} /> : null}

        {!needsSetup ? (
          isPortrait ? (
            <ScorecardPortrait
              participants={visibleParticipants}
              holesList={holesList}
              portraitCols={portraitCols}
              compactPlayers={compactPlayers}
              canScore={canScore}
              isFinished={isFinished}
              activeHole={activeHole}
              savingKey={savingKey}
              scoreView={scoreView}
              formatDisplay={activeFormatDisplay}
              metaSums={metaSums}
              totals={totals}
              displayedScoreFor={displayedScoreFor}
              onOpenEntry={openEntry}
              getParticipantLabel={scrambleGetLabel}
              getParticipantAvatar={scrambleGetAvatar}
            />
          ) : (
            <ScorecardLandscape
              participants={visibleParticipants}
              holesList={holesList}
              landscapePlan={landscapePlan}
              landscapeCols={landscapeCols}
              canScore={canScore}
              isFinished={isFinished}
              activeHole={activeHole}
              savingKey={savingKey}
              scoreView={scoreView}
              formatDisplay={activeFormatDisplay}
              metaSums={metaSums}
              totals={totals}
              displayedScoreFor={displayedScoreFor}
              onOpenEntry={openEntry}
              getParticipantLabel={scrambleGetLabel}
              getParticipantAvatar={scrambleGetAvatar}
            />
          )
        ) : null}

        {menuOpen && (
          <RoundMenuSheet
            onClose={() => setMenuOpen(false)}
            canFinish={canFinish}
            isFinished={isFinished}
            onFinishRound={() => {
              setMenuOpen(false);
              setFinishOpen(true);
            }}
            participants={visibleParticipants}
            formatDisplays={formatDisplays}
            grossTotals={grossTotals}
            netTotals={netTotals}
            parTotal={metaSums.parTot}
            getParticipantLabel={scrambleGetLabel}
            getParticipantAvatar={scrambleGetAvatar}
            courseLabel={courseLabel}
            formatType={formatType}
          />
        )}

        {finishOpen ? (
          <ConfirmSheet
            title="Finish round?"
            subtitle={<>
              {finishWarning && <span className="text-amber-300 block mb-1">{finishWarning}</span>}
              This will lock scoring for everyone. Any incomplete holes will be saved as Not Started (&mdash;).
            </>}
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

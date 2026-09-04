"use client";

import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";
import { StrokeDots, PlusIndicator, BadgeWrap, scoreBadgeType } from "@/components/round/ScorecardCells";
import { CoursePickerModal } from "@/components/rounds/CoursePickerModal";
import ScoreEntrySheet from "@/components/round/ScoreEntrySheet";
import type { Participant, Hole } from "@/lib/rounds/hooks/useRoundDetail";
import type {
  EventPlayoff,
  PlayoffHoleWithScores,
  CountbackResult,
} from "@/lib/majors/types";

interface Props {
  playoff: EventPlayoff;
  eventId: string;
  canScore: boolean;
  scoringModel?: string;
}

type Profile = { id: string; name: string | null; avatar_url: string | null };
type ScoreView = "gross" | "playoff";

export function PlayoffScorecardClient({ playoff, eventId, canScore, scoringModel = "net" }: Props) {
  const [holes, setHoles] = useState<PlayoffHoleWithScores[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [handicaps, setHandicaps] = useState<Record<string, number>>({});
  // Local copy of the playoff so status/winner reflect completion (the prop is stale).
  const [playoffState, setPlayoffState] = useState<EventPlayoff>(playoff);
  const [courseNames, setCourseNames] = useState<Record<string, string>>({});
  const [teeNames, setTeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [addingHole, setAddingHole] = useState(false);
  const [nextHole, setNextHole] = useState<number | null>(null);
  const [tiedAgain, setTiedAgain] = useState(false);
  const [remainingIds, setRemainingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scoreView, setScoreView] = useState<ScoreView>("playoff");

  // Score entry (reuses the normal ScoreEntrySheet)
  const [entryPid, setEntryPid] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<"quick" | "custom">("quick");
  const [customVal, setCustomVal] = useState("10");

  // Change course / tee
  const [teeOpen, setTeeOpen] = useState(false);

  // Decide by countback
  const [cbResult, setCbResult] = useState<CountbackResult | null>(null);
  const [cbLoading, setCbLoading] = useState(false);
  const [cbConfirming, setCbConfirming] = useState(false);

  async function load() {
    const session = await requireViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/events/${eventId}/playoff`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) { setLoading(false); return; }
    const json = await res.json();
    setHoles(json.holes ?? []);
    setHandicaps(json.handicaps ?? {});
    if (json.playoff) setPlayoffState(json.playoff);

    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", playoff.tied_profile_ids);
    const pm: Record<string, Profile> = {};
    for (const p of profileData ?? []) pm[p.id] = p;
    setProfiles(pm);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`playoff:${playoff.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_playoff_scores" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_playoff_holes" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playoff.id, eventId]);

  // Resolve course + tee box names for the holes (for the scorecard banner). Only
  // refetches when the set of courses changes.
  const courseKey = Array.from(new Set(holes.map((h) => h.course_id))).sort().join(",");
  useEffect(() => {
    const cids = courseKey ? courseKey.split(",") : [];
    if (!cids.length) return;
    let cancelled = false;
    (async () => {
      const cNames: Record<string, string> = {};
      const tNames: Record<string, string> = {};
      await Promise.all(cids.map(async (cid) => {
        const r = await fetch(`/api/courses/detail?course_id=${cid}`);
        if (!r.ok) return;
        const j = await r.json();
        cNames[cid] = j.course?.name ?? "";
        for (const t of j.tee_boxes ?? []) tNames[t.id] = t.name ?? "";
      }));
      if (!cancelled) { setCourseNames(cNames); setTeeNames(tNames); }
    })();
    return () => { cancelled = true; };
  }, [courseKey]);

  async function apiPost(body: Record<string, unknown>) {
    const session = await getViewerSession();
    if (!session) throw new Error("Not authenticated");
    const res = await fetch(`/api/majors/events/${eventId}/playoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Request failed");
    return json;
  }

  async function submitScore(holeId: string, pid: string, gross: number | null) {
    const key = `${pid}:${currentHole?.hole_number}`;
    setSaving(key);
    setError(null);
    try {
      await apiPost({ action: "submit_score", playoff_hole_id: holeId, target_profile_id: pid, gross_strokes: gross });
      setEntryPid(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  async function handleAdvance(holeId: string) {
    setAdvancing(true);
    setError(null);
    try {
      const json = await apiPost({ action: "advance", playoff_hole_id: holeId });
      if (json.complete) {
        const final_positions = playoff.tied_profile_ids.map((pid: string) => ({
          profile_id: pid,
          position: pid === json.winner_profile_id ? 1 : 2,
        }));
        await apiPost({ action: "complete", playoff_id: playoff.id, winner_profile_id: json.winner_profile_id, final_positions });
        await load();
      } else if (json.tied_again) {
        setTiedAgain(true);
        setRemainingIds(json.remaining);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdvancing(false);
    }
  }

  async function handleAddHole() {
    if (!nextHole) return;
    const lastHole = holes[holes.length - 1];
    setAddingHole(true);
    setError(null);
    try {
      await apiPost({
        action: "add_hole",
        playoff_id: playoff.id,
        hole_number: nextHole,
        course_id: lastHole.course_id,
        tee_box_id: lastHole.tee_box_id,
        remaining_profile_ids: remainingIds,
      });
      setTiedAgain(false);
      setNextHole(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingHole(false);
    }
  }

  async function handleDecideCountback() {
    const currentRemaining = currentHole?.remaining_profile_ids ?? playoff.tied_profile_ids;
    setCbLoading(true);
    setError(null);
    try {
      const json = await apiPost({ action: "resolve_countback", profile_ids: currentRemaining });
      setCbResult(json.result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCbLoading(false);
    }
  }

  async function handleConfirmCountback() {
    if (!cbResult?.winner_profile_id) return;
    setCbConfirming(true);
    setError(null);
    try {
      const final_positions = playoff.tied_profile_ids.map((pid: string) => ({
        profile_id: pid,
        position: pid === cbResult.winner_profile_id ? 1 : 2,
      }));
      await apiPost({
        action: "complete",
        playoff_id: playoff.id,
        winner_profile_id: cbResult.winner_profile_id,
        final_positions,
        resolution_type: "countback",
      });
      setCbResult(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCbConfirming(false);
    }
  }

  const currentHole = holes[holes.length - 1];
  const isComplete = playoffState.status === "completed";
  const isStableford = scoringModel === "stableford_points";

  // The value shown in a cell for the active tab.
  function cellValue(hole: PlayoffHoleWithScores, pid: string): { display: string | number | null; recv: number } {
    const score = hole.scores?.find((s) => s.profile_id === pid);
    const gross = score?.gross_strokes ?? null;
    const recv = strokesReceivedOnHole(handicaps[pid] ?? 0, hole.stroke_index);
    if (gross == null) return { display: null, recv: scoreView === "playoff" ? recv : 0 };
    if (scoreView === "gross") return { display: gross, recv: 0 };
    if (isStableford) return { display: Math.max(0, 2 - ((gross - recv) - hole.par)), recv };
    return { display: gross - recv, recv };
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center text-[color:var(--sec-muted)] text-sm">
        Loading playoff…
      </div>
    );
  }

  const players = playoff.tied_profile_ids;
  const gridCols = `28px 30px 26px repeat(${players.length}, minmax(0, 1fr))`;

  // Adapters so we can reuse the normal ScoreEntrySheet for the current hole only.
  const entryParticipants = players.map((id) => ({ id } as unknown as Participant));
  const entryHoles: Hole[] = currentHole
    ? [{ hole_number: currentHole.hole_number, par: currentHole.par, yardage: null, stroke_index: currentHole.stroke_index }]
    : [];
  const scoreForEntry = (pid: string) => currentHole?.scores?.find((s) => s.profile_id === pid)?.gross_strokes ?? null;

  return (
    <div className="min-h-[100dvh] pb-10 pt-12 px-4 max-w-md mx-auto space-y-4">
      <div className="text-center space-y-1">
        <p className="text-[10px] uppercase tracking-widest text-[color:var(--sec-muted)]">
          {isComplete ? "Playoff Complete" : "Sudden-Death Playoff"}
        </p>
        <h1 className="text-lg font-bold text-[color:var(--sec-accent)]">Playoff Scorecard</h1>
      </div>

      {/* Gross / Play-off tabs */}
      <div className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_50%,transparent)] p-1 flex items-center w-max mx-auto">
        {(["gross", "playoff"] as ScoreView[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setScoreView(v)}
            className={`px-3 py-1 text-[11px] font-semibold rounded-lg ${
              scoreView === v ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]" : "text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]"
            }`}
          >
            {v === "gross" ? "Gross" : "Play-off"}
          </button>
        ))}
      </div>

      {/* Portrait scorecard */}
      {holes.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_30%,transparent)] overflow-hidden">
          {/* Header */}
          <div className="grid" style={{ gridTemplateColumns: gridCols }}>
            <div className="h-9 flex items-center justify-center text-[10px] text-[color:var(--sec-muted)] border-b border-r border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)]">#</div>
            <div className="h-9 flex items-center justify-center text-[10px] text-[color:var(--sec-muted)] border-b border-r border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)]">Par</div>
            <div className="h-9 flex items-center justify-center text-[10px] text-[color:var(--sec-muted)] border-b border-r border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)]">SI</div>
            {players.map((pid) => (
              <div key={pid} className="h-9 flex items-center justify-center gap-1 px-1 border-b border-r border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)] min-w-0">
                <PlayerAvatar profile={profiles[pid]} />
                <span className="text-[10px] font-semibold text-[color:var(--sec-text)] truncate">
                  {(profiles[pid]?.name ?? "?").split(" ")[0]}
                </span>
              </div>
            ))}
          </div>

          {/* Hole rows, grouped by course/tee with a banner whenever it changes */}
          {holes.map((hole, hi) => {
            const isCurrent = hi === holes.length - 1 && !isComplete;
            const prev = holes[hi - 1];
            const showBanner = hi === 0 || hole.course_id !== prev.course_id || hole.tee_box_id !== prev.tee_box_id;
            return (
              <Fragment key={hole.id}>
              {showBanner && (
                <div className="px-3 py-1.5 bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] border-b border-[color:var(--sec-hair)] flex items-center gap-1.5">
                  <span className="text-[11px]">⛳</span>
                  <span className="text-[10px] font-semibold text-[color:var(--sec-muted)] truncate">
                    {courseNames[hole.course_id] || "Course"}
                    {teeNames[hole.tee_box_id] ? ` · ${teeNames[hole.tee_box_id]}` : ""}
                  </span>
                </div>
              )}
              <div className="grid" style={{ gridTemplateColumns: gridCols }}>
                <div className={`h-11 flex items-center justify-center text-[12px] font-extrabold border-b border-r border-[color:var(--sec-hair)] ${isCurrent ? "bg-[color:var(--ciaga-ground)] text-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-muted)]"}`}>
                  {hole.hole_number}
                </div>
                <div className="h-11 flex items-center justify-center text-[11px] text-[color:var(--sec-muted)] border-b border-r border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_20%,transparent)]">{hole.par}</div>
                <div className="h-11 flex items-center justify-center text-[11px] text-[color:var(--sec-muted)] border-b border-r border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_20%,transparent)]">{hole.stroke_index}</div>
                {players.map((pid) => {
                  const isRemaining = hole.remaining_profile_ids.includes(pid);
                  const { display, recv } = cellValue(hole, pid);
                  const gross = hole.scores?.find((s) => s.profile_id === pid)?.gross_strokes ?? null;
                  const badge = !isStableford && gross != null ? scoreBadgeType(typeof display === "number" ? display : gross, hole.par) : null;
                  // Editable on the current hole even after a score exists — tapping
                  // re-opens the entry sheet (which can change or clear the score).
                  const tappable = canScore && isCurrent && isRemaining;
                  const savingKey = `${pid}:${hole.hole_number}`;
                  return (
                    <button
                      key={pid}
                      type="button"
                      disabled={!tappable}
                      onClick={() => { if (tappable) { setEntryMode("quick"); setEntryPid(pid); } }}
                      className={`h-11 flex flex-col items-center justify-center gap-0.5 border-b border-r border-[color:var(--sec-hair)] font-semibold tabular-nums ${
                        isCurrent ? "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] text-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--sec-surface)_10%,transparent)] text-[color:var(--sec-text)]"
                      } ${tappable ? "hover:bg-[color:var(--sec-surface-2)]" : "cursor-default"} ${!isRemaining ? "opacity-40" : ""}`}
                    >
                      {!isRemaining ? (
                        <span className="text-[color:var(--sec-bad)] text-sm">✕</span>
                      ) : (
                        <>
                          <BadgeWrap type={badge}>
                            <span className="text-[13px] leading-none">{saving === savingKey ? "…" : (display ?? "–")}</span>
                          </BadgeWrap>
                          {recv > 0 ? <div className="leading-none"><StrokeDots count={recv} /></div>
                            : recv < 0 ? <div className="leading-none"><PlusIndicator count={Math.abs(recv)} /></div>
                            : <div className="h-[6px]" />}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Current hole controls */}
      {currentHole && !isComplete && canScore && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setTeeOpen(true)}
            className="w-full py-2 rounded-xl border border-[color:var(--sec-line)] text-[color:var(--sec-muted)] text-xs font-semibold hover:border-[color:var(--sec-accent)] hover:text-[color:var(--sec-text)]"
          >
            ⛳ Change course / tee
          </button>

          {!tiedAgain && currentHole.remaining_profile_ids.every((pid) =>
            currentHole.scores?.some((s) => s.profile_id === pid && s.gross_strokes != null)
          ) && (
            <button
              type="button"
              disabled={advancing}
              onClick={() => handleAdvance(currentHole.id)}
              className="w-full py-2.5 rounded-full bg-[color:var(--sec-primary)] text-white text-sm font-semibold disabled:opacity-50"
            >
              {advancing ? "Calculating…" : "Determine Result"}
            </button>
          )}
        </div>
      )}

      {/* Still tied — pick next hole */}
      {tiedAgain && canScore && !isComplete && (
        <div className="rounded-2xl border border-amber-700/50 bg-amber-900/20 px-4 py-3 space-y-3">
          <p className="text-xs font-semibold text-amber-300 text-center">Still tied — select the next hole</p>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setNextHole(h)}
                className={`rounded-xl py-1.5 text-xs font-bold transition-colors ${
                  nextHole === h ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]" : "border border-amber-700/30 text-amber-200"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!nextHole || addingHole}
            onClick={handleAddHole}
            className="w-full py-2 rounded-xl bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] text-sm font-semibold disabled:opacity-40"
          >
            {addingHole ? "Adding…" : "Continue Playoff"}
          </button>
        </div>
      )}

      {/* Decide by countback */}
      {!isComplete && canScore && (
        <button
          type="button"
          onClick={handleDecideCountback}
          disabled={cbLoading}
          className="w-full py-2 rounded-xl border border-[color:color-mix(in_srgb,var(--sec-accent)_40%,transparent)] text-[color:var(--sec-accent)] text-xs font-semibold disabled:opacity-50"
        >
          {cbLoading ? "Calculating countback…" : "Decide by countback instead"}
        </button>
      )}

      {/* Complete */}
      {isComplete && (
        <div className="rounded-2xl border border-[color:var(--sec-line)] bg-[color:var(--sec-surface)] px-4 py-4 text-center space-y-1">
          <p className="text-base font-bold text-[color:var(--sec-accent)]">🏆 Playoff Complete</p>
          <p className="text-[11px] text-[color:var(--sec-muted)]">
            Winner: {profiles[playoffState.winner_profile_id ?? ""]?.name ?? "Unknown"}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-[color:var(--sec-bad)] text-center">{error}</p>}

      {/* Score entry — the normal sheet, restricted to the current hole */}
      {entryPid && currentHole && (
        <ScoreEntrySheet
          participants={entryParticipants}
          holes={entryHoles}
          pid={entryPid}
          holeNumber={currentHole.hole_number}
          mode={entryMode}
          customVal={customVal}
          setMode={setEntryMode}
          setCustomVal={setCustomVal}
          canScore={canScore}
          isFinished={false}
          hideHoleState
          scoreFor={(pid) => scoreForEntry(pid)}
          savingKey={saving}
          holeState={"completed"}
          onSetPickedUp={() => {}}
          onSetNotStarted={() => {}}
          onClose={() => setEntryPid(null)}
          onSubmit={(strokes) => submitScore(currentHole.id, entryPid, strokes)}
          getParticipantLabel={(p) => profiles[p.id]?.name ?? "Player"}
          getParticipantAvatar={(p) => profiles[p.id]?.avatar_url ?? null}
        />
      )}

      {/* Change course / tee sheet */}
      {teeOpen && currentHole && (
        <ChangeTeeSheet
          hole={currentHole}
          onClose={() => setTeeOpen(false)}
          onApply={async (course_id, tee_box_id, hole_number) => {
            await apiPost({ action: "update_hole", playoff_hole_id: currentHole.id, course_id, tee_box_id, hole_number });
            setTeeOpen(false);
            await load();
          }}
        />
      )}

      {/* Countback confirm sheet */}
      {cbResult && (
        <CountbackConfirm
          result={cbResult}
          profiles={profiles}
          confirming={cbConfirming}
          onCancel={() => setCbResult(null)}
          onConfirm={handleConfirmCountback}
        />
      )}
    </div>
  );
}

function PlayerAvatar({ profile }: { profile: Profile | undefined }) {
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover shrink-0" loading="lazy" decoding="async" />;
  }
  return (
    <div className="h-5 w-5 rounded-full bg-[color:var(--sec-surface)] grid place-items-center text-[8px] font-bold text-[color:var(--sec-text-2)] shrink-0">
      {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
    </div>
  );
}

// ── Change course / tee sheet ──────────────────────────────────────────────
type TeeBox = { id: string; name: string | null };

function ChangeTeeSheet({
  hole,
  onClose,
  onApply,
}: {
  hole: PlayoffHoleWithScores;
  onClose: () => void;
  onApply: (courseId: string, teeBoxId: string, holeNumber: number) => Promise<void>;
}) {
  const [courseId, setCourseId] = useState(hole.course_id);
  const [teeBoxes, setTeeBoxes] = useState<TeeBox[]>([]);
  const [teeBoxId, setTeeBoxId] = useState(hole.tee_box_id);
  const [holeNumber, setHoleNumber] = useState(hole.hole_number);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadingTees, setLoadingTees] = useState(true);
  const [applying, setApplying] = useState(false);

  async function loadTees(cid: string) {
    setLoadingTees(true);
    try {
      const res = await fetch(`/api/courses/detail?course_id=${cid}`);
      if (res.ok) {
        const j = await res.json();
        setTeeBoxes(j.tee_boxes ?? []);
      }
    } finally {
      setLoadingTees(false);
    }
  }

  useEffect(() => { loadTees(courseId); }, [courseId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto rounded-t-3xl bg-[color:var(--ciaga-ground)] border-t border-[color:var(--sec-hair)] px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-sm font-semibold text-[color:var(--sec-text)]">Change course / tee</p>

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full py-2.5 rounded-xl border border-[color:var(--sec-line)] text-[color:var(--sec-text)] text-sm font-semibold"
        >
          Choose a different course
        </button>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--sec-muted)] mb-1">Tee box</p>
          {loadingTees ? (
            <p className="text-xs text-[color:var(--sec-muted)]">Loading tees…</p>
          ) : (
            <div className="space-y-1.5">
              {teeBoxes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTeeBoxId(t.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
                    teeBoxId === t.id ? "border-[color:var(--sec-accent)] text-[color:var(--sec-accent)]" : "border-[color:var(--sec-hair)] text-[color:var(--sec-muted)]"
                  }`}
                >
                  <span>{t.name ?? "Tee"}</span>
                  {teeBoxId === t.id && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--sec-muted)] mb-1">Hole</p>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHoleNumber(h)}
                className={`rounded-lg py-1.5 text-xs font-bold ${
                  holeNumber === h ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]" : "border border-[color:var(--sec-hair)] text-[color:var(--sec-muted)]"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={applying || !teeBoxId}
          onClick={async () => { setApplying(true); try { await onApply(courseId, teeBoxId, holeNumber); } finally { setApplying(false); } }}
          className="w-full py-2.5 rounded-full bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] text-sm font-semibold disabled:opacity-50"
        >
          {applying ? "Applying…" : "Apply"}
        </button>
        <button type="button" onClick={onClose} className="w-full py-1 text-[color:var(--sec-muted)] text-xs">Cancel</button>

        <CoursePickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(cid) => { setCourseId(cid); setTeeBoxId(""); setPickerOpen(false); }}
        />
      </div>
    </div>
  );
}

// ── Countback confirm sheet ────────────────────────────────────────────────
function CountbackConfirm({
  result,
  profiles,
  confirming,
  onCancel,
  onConfirm,
}: {
  result: CountbackResult;
  profiles: Record<string, Profile>;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const winnerName = profiles[result.winner_profile_id ?? ""]?.name ?? "Unknown";
  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/60" onClick={onCancel}>
      <div
        className="w-full max-w-md mx-auto rounded-t-3xl bg-[color:var(--ciaga-ground)] border-t border-[color:var(--sec-hair)] px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-sm font-semibold text-[color:var(--sec-text)]">Decide by countback</p>
        {result.winner_profile_id ? (
          <p className="text-center text-[13px] text-[color:var(--sec-muted)]">
            Winner: <span className="font-bold text-[color:var(--sec-accent)]">{winnerName}</span>
            {result.step_resolved && <span className="text-[color:var(--sec-muted)]"> (on {result.step_resolved})</span>}
          </p>
        ) : (
          <p className="text-center text-[13px] text-amber-300">Countback could not separate the players.</p>
        )}

        <div className="space-y-1.5">
          {result.breakdown.map((b) => (
            <div
              key={b.step}
              className={`rounded-lg border px-3 py-2 ${b.resolvedAt ? "border-[color:color-mix(in_srgb,var(--sec-accent)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--sec-accent)_5%,transparent)]" : "border-[color:var(--sec-hair)]"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[color:var(--sec-muted)]">
                  {b.step} <span className="text-[color:var(--sec-muted)]">({b.holeRange})</span>
                </span>
                {b.resolvedAt && <span className="text-[color:var(--sec-accent)] text-xs">✓</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(b.scores).map(([pid, v]) => (
                  <span key={pid} className="text-[10px] text-[color:var(--sec-muted)]">
                    {(profiles[pid]?.name ?? "?").split(" ")[0]}: <span className="text-[color:var(--sec-text)] font-semibold">{v ?? "–"}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={confirming || !result.winner_profile_id}
          onClick={onConfirm}
          className="w-full py-2.5 rounded-full bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] text-sm font-semibold disabled:opacity-50"
        >
          {confirming ? "Applying…" : "Confirm & apply result"}
        </button>
        <button type="button" onClick={onCancel} className="w-full py-1 text-[color:var(--sec-muted)] text-xs">Cancel</button>
      </div>
    </div>
  );
}

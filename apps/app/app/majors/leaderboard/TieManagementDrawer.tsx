"use client";

import { useEffect, useState } from "react";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import type { EventPlayoff, CountbackResult } from "@/lib/majors/types";

type Screen =
  | "choice"
  | "playoff_setup"
  | "countback_loading"
  | "countback_result";

interface Props {
  eventId: string;
  initialScreen?: Screen;
  onClose: () => void;
  onResolved: (playoff: EventPlayoff) => void;
}

export function TieManagementDrawer({ eventId, initialScreen, onClose, onResolved }: Props) {
  const [screen, setScreen] = useState<Screen>(initialScreen ?? "choice");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Playoff setup state
  const [selectedHole, setSelectedHole] = useState<number | null>(null);
  const [defaultCourseId, setDefaultCourseId] = useState<string | null>(null);
  const [defaultTeeId, setDefaultTeeId] = useState<string | null>(null);

  // Countback state
  const [countbackResult, setCountbackResult] = useState<CountbackResult | null>(null);
  const [confirmingCountback, setConfirmingCountback] = useState(false);

  // Load default tee info on mount
  useEffect(() => {
    (async () => {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/events/${eventId}/playoff`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const json = await res.json();
        setDefaultCourseId(json.default_course_id ?? null);
        setDefaultTeeId(json.default_tee_box_id ?? null);
      }
    })();
  }, [eventId]);

  async function apiPost(body: Record<string, unknown>) {
    const session = await getViewerSession();
    if (!session) throw new Error("Not authenticated");
    const res = await fetch(`/api/majors/events/${eventId}/playoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Request failed");
    return json;
  }

  async function handleStartPlayoff() {
    if (!selectedHole || !defaultCourseId || !defaultTeeId) {
      setError("Please select a hole");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const json = await apiPost({
        action: "create",
        resolution_type: "playoff",
        hole_number: selectedHole,
        course_id: defaultCourseId,
        tee_box_id: defaultTeeId,
      });
      onResolved(json.playoff);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCountback() {
    setScreen("countback_loading");
    setError(null);
    try {
      const json = await apiPost({ action: "resolve_countback" });
      setCountbackResult(json.result);
      setScreen("countback_result");
    } catch (e: any) {
      setError(e.message);
      setScreen("choice");
    }
  }

  async function handleConfirmCountback() {
    if (!countbackResult?.winner_profile_id) return;
    setConfirmingCountback(true);
    setError(null);
    try {
      // Create playoff record for countback, then immediately complete it
      const createJson = await apiPost({ action: "create", resolution_type: "countback" });
      await apiPost({
        action: "complete",
        playoff_id: createJson.playoff.id,
        winner_profile_id: countbackResult.winner_profile_id,
        final_positions: countbackResult.final_positions,
      });
      // Refresh to get the updated playoff record
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/events/${eventId}/playoff`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const json = await res.json();
      if (json.playoff) onResolved(json.playoff);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirmingCountback(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="w-10 h-1 rounded-full bg-emerald-700/40 mx-auto mb-5" />

        {screen === "choice" && (
          <ChoiceScreen
            onPlayoff={() => setScreen("playoff_setup")}
            onCountback={handleCountback}
          />
        )}

        {screen === "playoff_setup" && (
          <PlayoffSetupScreen
            selectedHole={selectedHole}
            onSelectHole={setSelectedHole}
            onStart={handleStartPlayoff}
            onBack={() => setScreen("choice")}
            loading={loading}
            error={error}
          />
        )}

        {screen === "countback_loading" && (
          <div className="py-10 text-center text-emerald-100/60 text-sm">
            Running countback…
          </div>
        )}

        {screen === "countback_result" && countbackResult && (
          <CountbackResultScreen
            result={countbackResult}
            onConfirm={handleConfirmCountback}
            onBack={() => setScreen("choice")}
            loading={confirmingCountback}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

function ChoiceScreen({
  onPlayoff,
  onCountback,
}: {
  onPlayoff: () => void;
  onCountback: () => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-[#f5e6b0] text-center">Resolve Tie</h2>
      <p className="text-[11px] text-emerald-100/50 text-center">
        Choose how to decide the winner
      </p>
      <button
        type="button"
        onClick={onPlayoff}
        className="w-full rounded-2xl border border-emerald-700/40 bg-emerald-900/30 px-4 py-4 text-left"
      >
        <p className="text-sm font-semibold text-emerald-200">Playoff</p>
        <p className="text-[11px] text-emerald-100/50 mt-0.5">
          Sudden death — players compete hole-by-hole until one wins
        </p>
      </button>
      <button
        type="button"
        onClick={onCountback}
        className="w-full rounded-2xl border border-emerald-700/40 bg-emerald-900/30 px-4 py-4 text-left"
      >
        <p className="text-sm font-semibold text-emerald-200">Countback</p>
        <p className="text-[11px] text-emerald-100/50 mt-0.5">
          Compare scores over the last 9, 6, 3 holes, then individual holes
        </p>
      </button>
    </div>
  );
}

function PlayoffSetupScreen({
  selectedHole,
  onSelectHole,
  onStart,
  onBack,
  loading,
  error,
}: {
  selectedHole: number | null;
  onSelectHole: (h: number) => void;
  onStart: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-emerald-100/60 text-sm">←</button>
        <h2 className="text-base font-semibold text-[#f5e6b0]">Select Playoff Hole</h2>
      </div>
      <p className="text-[11px] text-emerald-100/50">
        Choose the hole for the sudden-death playoff. Tied players will be revealed once you start.
      </p>

      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onSelectHole(h)}
            className={`rounded-xl py-2 text-sm font-bold transition-colors ${
              selectedHole === h
                ? "bg-[#f5e6b0] text-[#042713]"
                : "border border-emerald-700/40 text-emerald-200 hover:bg-emerald-900/40"
            }`}
          >
            {h}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={onStart}
        disabled={!selectedHole || loading}
        className="w-full py-3 rounded-full bg-[#f5e6b0] text-[#042713] text-sm font-semibold disabled:opacity-40"
      >
        {loading ? "Starting…" : "Start Playoff"}
      </button>
    </div>
  );
}

function CountbackResultScreen({
  result,
  onConfirm,
  onBack,
  loading,
  error,
}: {
  result: CountbackResult;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-emerald-100/60 text-sm">←</button>
        <h2 className="text-base font-semibold text-[#f5e6b0]">Countback Result</h2>
      </div>

      <div className="space-y-2">
        {result.breakdown.map((step) => (
          <div
            key={step.step}
            className={`rounded-xl border px-3 py-2 text-[11px] ${
              step.resolvedAt
                ? "border-emerald-600/50 bg-emerald-900/30"
                : "border-emerald-900/30 bg-transparent"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`font-semibold ${step.resolvedAt ? "text-emerald-300" : "text-emerald-100/60"}`}>
                {step.step} (holes {step.holeRange})
                {step.resolvedAt && " — Resolved ✓"}
              </span>
            </div>
            <div className="flex gap-4">
              {Object.entries(step.scores).map(([pid, score]) => (
                <span key={pid} className="text-emerald-100/70">
                  {pid.slice(0, 6)}: {score ?? "—"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {result.winner_profile_id ? (
        <p className="text-xs text-emerald-300 font-semibold text-center">
          Winner determined via {result.step_resolved}
        </p>
      ) : (
        <p className="text-xs text-amber-400 text-center">
          Could not resolve — all countback steps are tied
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={onConfirm}
        disabled={!result.winner_profile_id || loading}
        className="w-full py-3 rounded-full bg-[#f5e6b0] text-[#042713] text-sm font-semibold disabled:opacity-40"
      >
        {loading ? "Applying…" : "Confirm & Apply Result"}
      </button>
    </div>
  );
}

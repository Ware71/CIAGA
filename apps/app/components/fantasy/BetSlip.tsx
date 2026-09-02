"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { safeJson } from "@/lib/fantasy/safeJson";
import { useSlip } from "@/lib/fantasy/slipStore";
import { combinedOdds, findParlayViolation, MAX_LEGS } from "@/lib/fantasy/parlayRules";
import { COMBO_BET } from "@/lib/fantasy/terminology";
import { OddsValue } from "@/components/fantasy/OddsValue";

/**
 * The floating bet slip: singles (one pick per leg) or an Acca (combined
 * odds, one stake) when the legs are combinable — same group, no correlated
 * subjects within an event (server re-enforces both).
 */

type Mode = "singles" | "acca";

export function BetSlip({ onPlaced }: { onPlaced?: () => void }) {
  const router = useRouter();
  const { legs, remove, clear } = useSlip();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("singles");
  const [stake, setStake] = useState(10);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Naive product — the immediate display + fallback while the joint price loads.
  const accaOdds = useMemo(() => combinedOdds(legs.map((l) => l.decimalOdds)), [legs]);
  const sameGroup = useMemo(() => new Set(legs.map((l) => l.groupId)).size <= 1, [legs]);
  const violation = useMemo(
    () =>
      findParlayViolation(
        legs.map((l) => ({
          eventId: l.eventId,
          marketId: l.marketId,
          marketType: l.marketType ?? "",
          params: l.params ?? null,
          subjectKeys: l.subjectKeys,
          selectionKey: l.selectionKey,
          subjectProfileId: l.subjectProfileId,
          opponentProfileId: l.opponentProfileId,
          eventRankingBasis: l.eventRankingBasis,
        }))
      ),
    [legs]
  );
  const accaBlockedReason =
    legs.length < 2
      ? `Add ${2 - legs.length} more selection${legs.length === 1 ? "" : "s"}`
      : legs.length > MAX_LEGS
      ? `Max ${MAX_LEGS} legs`
      : !sameGroup
      ? "Legs must come from one group"
      : violation
      ? violation
      : null;

  // Correlated legs (finishing positions, h2h, own-score markets) are jointly
  // priced server-side — fetch the true combined odds (falls back to the
  // product while loading or on error). A joint count of zero means the legs
  // contradict each other; a sub-support count is too rare to price reliably.
  const [jointOdds, setJointOdds] = useState<number | null>(null);
  const [infeasible, setInfeasible] = useState(false);
  const [lowSupport, setLowSupport] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setJointOdds(null);
    setInfeasible(false);
    setLowSupport(false);
    if (legs.length < 2 || accaBlockedReason) return;
    (async () => {
      try {
        const session = await requireViewerSession();
        if (!session) return;
        const res = await fetch("/api/fantasy/parlays/price", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            legs: legs.map((l) => ({
              marketId: l.marketId,
              selectionKey: l.selectionKey,
              snapshotId: l.snapshotId,
            })),
          }),
        });
        const j = await safeJson(res);
        if (!cancelled && res.ok && typeof (j as { combinedOdds?: number }).combinedOdds === "number") {
          setJointOdds((j as { combinedOdds: number }).combinedOdds);
          setInfeasible(!!(j as { infeasible?: boolean }).infeasible);
          setLowSupport(!!(j as { lowSupport?: boolean }).lowSupport);
        }
      } catch {
        // Keep the product fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [legs, accaBlockedReason]);

  const displayAccaOdds = jointOdds ?? accaOdds;
  const blockedReason =
    accaBlockedReason ??
    (infeasible
      ? "Those selections can't all land together"
      : lowSupport
      ? "That combination is too rare to price reliably — remove a leg"
      : null);

  if (legs.length === 0) return null;
  if (typeof document === "undefined") return null;

  const placeSingles = async () => {
    setPlacing(true);
    setError(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      let placed = 0;
      const failures: string[] = [];
      for (const leg of legs) {
        const res = await fetch("/api/fantasy/picks", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            marketId: leg.marketId,
            selectionKey: leg.selectionKey,
            snapshotId: leg.snapshotId,
            stake,
          }),
        });
        const j = await safeJson(res);
        if (res.ok) {
          placed += 1;
          remove(leg.marketId, leg.selectionKey);
        } else {
          failures.push(`${leg.selectionLabel}: ${(j as { error?: string }).error ?? "failed"}`);
        }
      }
      if (failures.length > 0) {
        setError(failures.join(" · "));
        if (placed > 0) setSuccess(`${placed} pick${placed > 1 ? "s" : ""} placed`);
      } else {
        setSuccess(`${placed} pick${placed > 1 ? "s" : ""} placed — ${stake} pts each`);
      }
      onPlaced?.();
    } finally {
      setPlacing(false);
    }
  };

  const placeAcca = async () => {
    setPlacing(true);
    setError(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch("/api/fantasy/parlays", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          legs: legs.map((l) => ({
            marketId: l.marketId,
            selectionKey: l.selectionKey,
            snapshotId: l.snapshotId,
          })),
          stake,
        }),
      });
      const j = await safeJson(res);
      if (!res.ok) {
        setError((j as { error?: string }).error ?? `Failed to place ${COMBO_BET.short}`);
        return;
      }
      setSuccess(`${legs.length}-leg ${COMBO_BET.short} placed — ${stake} pts`);
      clear();
      onPlaced?.();
    } finally {
      setPlacing(false);
    }
  };

  return createPortal(
    <>
      {/* Floating slip bar */}
      {!open && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+var(--ciaga-nav-h)+8px)] left-0 right-0 z-40 px-4">
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setSuccess(null);
              setError(null);
            }}
            className="mx-auto flex w-full max-w-sm items-center justify-between rounded-2xl border border-[color:var(--sec-line)] bg-[color:var(--sec-surface)] px-4 py-3 shadow-xl shadow-black/40"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--sec-accent)] text-[11px] font-bold text-[color:var(--ciaga-ground)]">
                {legs.length}
              </span>
              <span className="text-[12px] font-semibold text-[color:var(--sec-text)]">Bet Slip</span>
            </span>
            <span className="text-[12px] font-bold text-[color:var(--sec-accent)]">
              {legs.length >= 2 && !blockedReason ? (
                <>
                  {COMBO_BET.short} <OddsValue odds={displayAccaOdds} />
                </>
              ) : (
                "View →"
              )}
            </span>
          </button>
        </div>
      )}

      {/* Slip drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="relative mx-auto w-full max-w-sm rounded-t-3xl border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-5 pt-4 pb-[calc(env(safe-area-inset-bottom)+20px)] max-h-[85dvh] overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold text-[color:var(--sec-accent)]">Bet Slip ({legs.length})</div>
              <button
                type="button"
                onClick={clear}
                className="text-[11px] text-[color:var(--sec-muted)] hover:text-[color:var(--sec-text)]"
              >
                Clear all
              </button>
            </div>

            {/* Mode tabs */}
            <div className="mb-3 flex gap-1 rounded-full border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_50%,transparent)] p-1">
              {(["singles", "acca"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-full py-1.5 text-[11px] font-semibold ${
                    mode === m
                      ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]"
                      : "text-[color:var(--sec-muted)]"
                  }`}
                >
                  {m === "singles" ? `Singles (${legs.length})` : COMBO_BET.short}
                </button>
              ))}
            </div>

            {/* Legs */}
            <div className="mb-3 space-y-1.5">
              {legs.map((leg) => (
                <div
                  key={`${leg.marketId}|${leg.selectionKey}`}
                  className="flex items-center justify-between rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_60%,transparent)] px-3 py-2"
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate text-[12px] font-semibold text-[color:var(--sec-text)]">
                      {leg.selectionLabel}
                    </div>
                    <div className="truncate text-[10px] text-[color:var(--sec-muted)]">
                      {leg.marketLabel} · {leg.eventName}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] font-bold text-[color:var(--sec-accent)]">
                      <OddsValue odds={leg.decimalOdds} />
                    </span>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() => remove(leg.marketId, leg.selectionKey)}
                      className="text-[color:var(--sec-muted)] hover:text-[color:var(--sec-bad)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Stake */}
            <div className="mb-2 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setStake((s) => Math.max(1, s - 5))}
                className="h-10 w-10 rounded-full border border-[color:var(--sec-hair)] text-lg text-[color:var(--sec-text-2)]"
              >
                −
              </button>
              <div className="min-w-[90px] text-center">
                <div className="text-2xl font-bold text-[color:var(--sec-text)]">{stake}</div>
                <div className="text-[10px] text-[color:var(--sec-muted)]">
                  {mode === "singles" ? "points per pick" : "points stake"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStake((s) => s + 5)}
                className="h-10 w-10 rounded-full border border-[color:var(--sec-hair)] text-lg text-[color:var(--sec-text-2)]"
              >
                +
              </button>
            </div>
            <div className="mb-3 flex justify-center gap-1.5">
              {[5, 10, 25, 50].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setStake(q)}
                  className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${
                    stake === q
                      ? "border-[color:var(--sec-line)] bg-[color:var(--sec-primary)] text-white"
                      : "border-[color:var(--sec-hair)] text-[color:var(--sec-muted)]"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Returns */}
            <div className="mb-3 text-center text-[11px] text-[color:var(--sec-muted)]">
              {mode === "singles" ? (
                <>
                  Total staked:{" "}
                  <span className="font-bold text-[color:var(--sec-accent)]">{stake * legs.length} pts</span>
                </>
              ) : blockedReason ? (
                <span className="text-amber-300/90">{blockedReason}</span>
              ) : (
                <>
                  {legs.length}-leg {COMBO_BET.short} @{" "}
                  <span className="font-bold text-[color:var(--sec-accent)]">
                    <OddsValue odds={displayAccaOdds} />
                  </span>
                  {" · "}returns{" "}
                  <span className="font-bold text-[color:var(--sec-accent)]">
                    {(stake * displayAccaOdds).toFixed(2)} pts
                  </span>
                </>
              )}
            </div>

            {error && <div className="mb-2 text-center text-[11px] text-[color:var(--sec-bad)]">{error}</div>}
            {success && (
              <div className="mb-2 text-center text-[11px] font-semibold text-[color:var(--sec-good)]">
                {success}{" "}
                <button
                  type="button"
                  onClick={() => router.push("/majors/fantasy/picks")}
                  className="underline"
                >
                  My picks →
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={placing || (mode === "acca" && !!blockedReason)}
              onClick={mode === "singles" ? placeSingles : placeAcca}
              className="w-full rounded-full bg-[color:var(--sec-primary)] py-2.5 text-sm font-semibold text-white hover:bg-[color:var(--sec-primary-hover)] disabled:opacity-50"
            >
              {placing
                ? "Placing…"
                : mode === "singles"
                ? `Place ${legs.length} single${legs.length > 1 ? "s" : ""} — ${stake} pts each`
                : `Place ${COMBO_BET.short} — ${stake} pts`}
            </button>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}

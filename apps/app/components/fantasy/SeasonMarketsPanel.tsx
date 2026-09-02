"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { safeJson } from "@/lib/fantasy/safeJson";
import { OddsValue } from "@/components/fantasy/OddsValue";

type Selection = { key: string; label: string; decimal_odds: number; probability: number; snapshot_id: string };
type Market = { id: string; market_type: string; label: string; selections: Selection[] };
export type SeasonBoard = {
  generated: boolean;
  error?: string | null;
  season: { id: string; group_id: string; name: string };
  state?: { is_final: boolean; odds_stale: boolean; narrative: string | null; last_refreshed_at: string | null };
  markets?: Market[];
};

type Picking = { marketId: string; selection: Selection; marketLabel: string };

/**
 * Season markets board body — narrative, market list, and the stake bottom
 * sheet. Fetches its own data from the season odds route so it can be dropped
 * into both the standalone season page and the event board's Season tab.
 * `onLoaded` surfaces the loaded board (used for the page title).
 */
export function SeasonMarketsPanel({
  seasonId,
  onLoaded,
}: {
  seasonId: string;
  onLoaded?: (board: SeasonBoard) => void;
}) {
  const [board, setBoard] = useState<SeasonBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [stake, setStake] = useState(10);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const fetchBoard = useCallback(async () => {
    const session = await requireViewerSession();
    if (!session) return;
    const res = await fetch(`/api/fantasy/seasons/${seasonId}/odds`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    const j = await safeJson(res);
    if (res.ok) {
      setBoard(j as SeasonBoard);
      onLoaded?.(j as SeasonBoard);
    }
  }, [seasonId, onLoaded]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchBoard();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBoard]);

  const placePick = async () => {
    if (!picking) return;
    setPlacing(true);
    setMsg(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/seasons/${seasonId}/pick`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonMarketId: picking.marketId,
          selectionKey: picking.selection.key,
          snapshotId: picking.selection.snapshot_id,
          stake,
        }),
      });
      const j = await safeJson(res);
      if (!res.ok) {
        setMsg((j as { error?: string }).error ?? "Pick failed");
        return;
      }
      setPicking(null);
      setMsg("Season pick placed");
      await fetchBoard();
    } finally {
      setPlacing(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-[color:var(--sec-muted)] text-center py-20">Loading…</div>;
  }
  if (!board?.generated || !board.markets) {
    return (
      <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_80%,transparent)] px-4 py-6 text-center text-sm text-[color:var(--sec-muted)]">
        {board?.error ?? "Season markets aren't available for this group yet."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {board.state?.narrative && (
        <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-gradient-to-br from-[color:color-mix(in_srgb,var(--sec-surface)_90%,transparent)] to-[color:color-mix(in_srgb,var(--sec-surface)_90%,transparent)] px-4 py-3">
          <p className="text-[12px] leading-relaxed text-[color:var(--sec-muted)]">{board.state.narrative}</p>
        </div>
      )}
      {msg && <div className="text-center text-[11px] font-semibold text-[color:var(--sec-good)]">{msg}</div>}
      {board.markets.map((market) => (
        <section key={market.id} className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] overflow-hidden">
          <div className="px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:color-mix(in_srgb,var(--sec-accent)_80%,transparent)]">
            {market.label}
          </div>
          <div className="px-2.5 pb-2.5 space-y-1">
            {market.selections.length === 0 ? (
              <div className="px-1 py-2 text-[11px] text-[color:var(--sec-muted)]">No prices yet.</div>
            ) : (
              market.selections.map((sel) => (
                <div
                  key={sel.key}
                  className="flex items-center justify-between py-1 border-b border-[color:var(--sec-hair)] last:border-b-0"
                >
                  <span className="text-[12px] text-[color:var(--sec-muted)] truncate pr-2">{sel.label}</span>
                  <button
                    type="button"
                    disabled={board.state?.is_final}
                    onClick={() => setPicking({ marketId: market.id, selection: sel, marketLabel: market.label })}
                    className="shrink-0 min-w-[58px] rounded-lg border border-[color:var(--sec-line)] bg-[color:var(--sec-surface)] px-2 py-1 text-center text-[11px] font-bold text-[color:var(--sec-accent)] hover:bg-[color:var(--sec-surface-2)] active:scale-95 disabled:opacity-40"
                  >
                    <OddsValue odds={sel.decimal_odds} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      ))}

      {picking && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end">
            <button type="button" aria-label="Close" onClick={() => setPicking(null)} className="absolute inset-0 bg-black/60" />
            <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              <div className="text-sm font-bold text-[color:var(--sec-accent)] mb-0.5">{picking.selection.label}</div>
              <div className="text-[11px] text-[color:var(--sec-muted)] mb-4">
                {picking.marketLabel} @ <OddsValue odds={picking.selection.decimal_odds} />
              </div>
              <div className="flex items-center justify-center gap-4 mb-3">
                <button type="button" onClick={() => setStake((s) => Math.max(1, s - 5))} className="h-10 w-10 rounded-full border border-[color:var(--sec-hair)] text-lg text-[color:var(--sec-text-2)]">−</button>
                <div className="min-w-[90px] text-center">
                  <div className="text-2xl font-bold text-[color:var(--sec-text)]">{stake}</div>
                  <div className="text-[10px] text-[color:var(--sec-muted)]">points stake</div>
                </div>
                <button type="button" onClick={() => setStake((s) => s + 5)} className="h-10 w-10 rounded-full border border-[color:var(--sec-hair)] text-lg text-[color:var(--sec-text-2)]">+</button>
              </div>
              <div className="mb-3 text-center text-[11px] text-[color:var(--sec-muted)]">
                Returns{" "}
                <span className="font-bold text-[color:var(--sec-accent)]">{(stake * picking.selection.decimal_odds).toFixed(2)} pts</span>
              </div>
              <button
                type="button"
                onClick={placePick}
                disabled={placing}
                className="w-full py-2.5 rounded-full bg-[color:var(--sec-primary)] text-sm font-semibold text-white hover:bg-[color:var(--sec-primary-hover)] disabled:opacity-50"
              >
                {placing ? "Placing…" : `Place season pick — ${stake} pts`}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { safeJson } from "@/lib/fantasy/safeJson";
import { OddsValue } from "@/components/fantasy/OddsValue";

type Pick = {
  id: string;
  event_id: string;
  selection_key: string;
  stake: number;
  decimal_odds: number;
  potential_return: number;
  status: "open" | "cashed_out" | "won" | "lost" | "void";
  cashout_value: number | null;
  placed_at: string;
  settled_at: string | null;
  market_label: string;
  selection_label: string;
  event_name: string;
  event_status: string;
  group_name: string;
};

const STATUS_STYLES: Record<Pick["status"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "text-emerald-300 border-emerald-700/50" },
  won: { label: "Won", cls: "text-[#f5e6b0] border-[#f5e6b0]/40" },
  lost: { label: "Lost", cls: "text-red-300/80 border-red-900/50" },
  void: { label: "Void", cls: "text-emerald-200/50 border-emerald-900/50" },
  cashed_out: { label: "Cashed out", cls: "text-amber-300/80 border-amber-800/40" },
};

type Offer = {
  id: string;
  pick_id: string;
  offer_value: number;
  expires_at: string;
};

type ParlayLeg = {
  id: string;
  event_id: string;
  selection_key: string;
  decimal_odds: number;
  status: "open" | "won" | "lost" | "void";
  market_label: string;
  selection_label: string;
  event_name: string;
};

type Parlay = {
  id: string;
  stake: number;
  combined_decimal_odds: number;
  potential_return: number;
  status: "open" | "won" | "lost" | "void";
  placed_at: string;
  group_name: string;
  legs: ParlayLeg[];
};

const LEG_DOT: Record<ParlayLeg["status"], string> = {
  open: "bg-emerald-200/30",
  won: "bg-emerald-400",
  lost: "bg-red-400",
  void: "bg-amber-300/60",
};

export default function MyPicksClient() {
  const router = useRouter();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "settled" | "accas">("open");
  // Cash-out drawer
  const [cashoutPick, setCashoutPick] = useState<Pick | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [cashoutSuccess, setCashoutSuccess] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPicks = useCallback(async () => {
    const session = await getViewerSession();
    if (!session) return;
    const [picksRes, parlaysRes] = await Promise.all([
      fetch("/api/fantasy/picks", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }),
      fetch("/api/fantasy/parlays", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }),
    ]);
    if (picksRes.ok) {
      const j = await picksRes.json();
      setPicks(j.picks ?? []);
    }
    if (parlaysRes.ok) {
      const j = await parlaysRes.json();
      setParlays(j.parlays ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchPicks();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchPicks]);

  const openPicks = picks.filter((p) => p.status === "open");
  const settledPicks = picks.filter((p) => p.status !== "open");
  const shown = tab === "open" ? openPicks : settledPicks;

  const stopCountdown = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const startCountdown = (expiresAt: string) => {
    stopCountdown();
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) stopCountdown();
    };
    tick();
    countdownRef.current = setInterval(tick, 250);
  };

  useEffect(() => stopCountdown, []);

  const requestQuote = async (pick: Pick) => {
    setQuoting(true);
    setCashoutError(null);
    setOffer(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/picks/${pick.id}/cashout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const j = await safeJson(res);
      if (!res.ok) {
        setCashoutError(j.error ?? "Cash-out unavailable");
        return;
      }
      setOffer(j.offer);
      startCountdown(j.offer.expires_at);
    } finally {
      setQuoting(false);
    }
  };

  const openCashout = (pick: Pick) => {
    setCashoutPick(pick);
    setCashoutSuccess(null);
    setCashoutError(null);
    setOffer(null);
    requestQuote(pick);
  };

  const closeCashout = () => {
    setCashoutPick(null);
    setOffer(null);
    stopCountdown();
  };

  const handleAccept = async () => {
    if (!offer) return;
    setAccepting(true);
    setCashoutError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/fantasy/cashout/${offer.id}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const j = await safeJson(res);
      if (!res.ok) {
        setCashoutError(j.error ?? "Failed to accept offer");
        setOffer(null);
        stopCountdown();
        return;
      }
      setCashoutSuccess(j.value);
      stopCountdown();
      await fetchPicks();
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      <div className="px-4 pt-8 flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => router.push("/majors/fantasy")}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← Fantasy
        </button>
        <h1 className="text-lg font-bold tracking-wide text-[#f5e6b0]">My Picks</h1>
        <div className="w-12" />
      </div>

      <div className="px-4 mb-4 flex gap-2">
        {(["open", "settled", "accas"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              tab === t ? "bg-emerald-700 text-white" : "border border-emerald-900/60 text-emerald-200/70"
            }`}
          >
            {t === "open"
              ? `Open (${openPicks.length})`
              : t === "settled"
              ? `Settled (${settledPicks.length})`
              : `Accas (${parlays.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : tab === "accas" ? (
        <div className="px-4 space-y-2 pb-12">
          {parlays.length === 0 && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center text-sm text-emerald-100/70">
              No accumulators yet — add two or more selections to the bet slip.
            </div>
          )}
          {parlays.map((parlay) => {
            const badge = STATUS_STYLES[parlay.status === "open" ? "open" : parlay.status];
            return (
              <div
                key={parlay.id}
                className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[12px] font-semibold text-emerald-50">
                    {parlay.legs.length}-leg Acca @{" "}
                    <OddsValue odds={parlay.combined_decimal_odds} />
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="space-y-1 mb-1.5">
                  {parlay.legs.map((leg) => (
                    <button
                      key={leg.id}
                      type="button"
                      onClick={() => router.push(`/majors/fantasy/events/${leg.event_id}`)}
                      className="w-full flex items-center gap-2 text-left"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LEG_DOT[leg.status]}`} />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-emerald-100/85">
                        {leg.selection_label}
                        <span className="text-emerald-200/50"> · {leg.market_label}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-emerald-200/60">
                        <OddsValue odds={leg.decimal_odds} />
                      </span>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-emerald-200/55">
                  {parlay.stake} pts stake ·{" "}
                  {parlay.status === "won"
                    ? `returned ${parlay.potential_return} pts`
                    : parlay.status === "void"
                    ? "stake returned"
                    : `returns ${parlay.potential_return} pts`}
                  {parlay.group_name ? ` · ${parlay.group_name}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      ) : shown.length === 0 ? (
        <div className="px-4">
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center text-sm text-emerald-100/70">
            {tab === "open" ? "No open picks — find an event and back someone." : "No settled picks yet."}
          </div>
        </div>
      ) : (
        <div className="px-4 space-y-2 pb-12">
          {shown.map((p) => {
            const badge = STATUS_STYLES[p.status];
            return (
              <div
                key={p.id}
                className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => router.push(`/majors/fantasy/events/${p.event_id}`)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="text-[13px] font-semibold text-emerald-50 truncate pr-2">
                      {p.selection_label}
                    </div>
                    <span className={`shrink-0 text-[9px] uppercase tracking-wider border rounded-full px-2 py-0.5 ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-[10px] text-emerald-200/50 truncate">
                    {p.market_label} · {p.event_name}{p.group_name ? ` · ${p.group_name}` : ""}
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-emerald-200/60">
                      {p.stake} pts @ <OddsValue odds={Number(p.decimal_odds)} />
                    </span>
                    <span className="text-[11px] font-bold text-[#f5e6b0]">
                      {p.status === "won"
                        ? `+${p.potential_return} pts`
                        : p.status === "cashed_out" && p.cashout_value != null
                        ? `+${p.cashout_value} pts`
                        : p.status === "void"
                        ? "stake returned"
                        : p.status === "lost"
                        ? `−${p.stake} pts`
                        : `returns ${p.potential_return} pts`}
                    </span>
                  </div>
                </button>
                {p.status === "open" && p.event_status !== "completed" && (
                  <button
                    type="button"
                    onClick={() => openCashout(p)}
                    className="mt-2 w-full py-1.5 rounded-full border border-amber-800/50 text-[11px] font-semibold text-amber-300/90 hover:bg-amber-900/20"
                  >
                    Cash out
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cash-out drawer */}
      {cashoutPick && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end">
            <button
              type="button"
              aria-label="Close"
              onClick={closeCashout}
              className="absolute inset-0 bg-black/60"
            />
            <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-emerald-900/70 bg-[#07301a] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              <div className="text-sm font-bold text-[#f5e6b0] mb-0.5 truncate">
                {cashoutPick.selection_label}
              </div>
              <div className="text-[11px] text-emerald-200/60 mb-4 truncate">
                {cashoutPick.market_label} · staked {cashoutPick.stake} pts, returns {cashoutPick.potential_return} pts
              </div>

              {cashoutSuccess != null ? (
                <div className="text-center space-y-3 py-2">
                  <div className="text-lg font-bold text-emerald-300">
                    Cashed out for {cashoutSuccess} pts
                  </div>
                  <button
                    type="button"
                    onClick={closeCashout}
                    className="w-full py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white"
                  >
                    Done
                  </button>
                </div>
              ) : quoting ? (
                <div className="text-sm text-emerald-100/60 text-center py-6">
                  Pricing your cash-out…
                </div>
              ) : offer && secondsLeft > 0 ? (
                <div className="space-y-3">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-[#f5e6b0]">{offer.offer_value} pts</div>
                    <div className="text-[10px] text-emerald-200/50 mt-1">
                      Offer expires in {secondsLeft}s
                    </div>
                  </div>
                  <div className="h-1 rounded-full bg-emerald-900/50 overflow-hidden">
                    <div
                      className="h-full bg-amber-400/80 transition-all duration-200"
                      style={{ width: `${Math.min(100, (secondsLeft / 15) * 100)}%` }}
                    />
                  </div>
                  {cashoutError && (
                    <div className="text-[11px] text-red-300 text-center">{cashoutError}</div>
                  )}
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={accepting}
                    className="w-full py-2.5 rounded-full bg-amber-600 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                  >
                    {accepting ? "Accepting…" : `Accept ${offer.offer_value} pts`}
                  </button>
                  <button
                    type="button"
                    onClick={closeCashout}
                    className="w-full py-2 rounded-full border border-emerald-900/60 text-[12px] text-emerald-200/70"
                  >
                    Keep my pick
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {cashoutError ? (
                    <div className="text-[12px] text-red-300 text-center py-2">{cashoutError}</div>
                  ) : (
                    <div className="text-[12px] text-emerald-200/60 text-center py-2">
                      {offer ? "Offer expired." : "No offer available."}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => requestQuote(cashoutPick)}
                    className="w-full py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white"
                  >
                    {offer ? "Get a new offer" : "Try again"}
                  </button>
                  <button
                    type="button"
                    onClick={closeCashout}
                    className="w-full py-2 rounded-full border border-emerald-900/60 text-[12px] text-emerald-200/70"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

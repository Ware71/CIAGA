"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { safeJson } from "@/lib/fantasy/safeJson";
import { COMBO_BET } from "@/lib/fantasy/terminology";
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
  cashout_estimate: number | null;
  placed_at: string;
  settled_at: string | null;
  market_label: string;
  selection_label: string;
  event_name: string;
  event_status: string;
  group_name: string;
};

type SettledStatus = "won" | "lost" | "void" | "cashed_out";
type AnyStatus = "open" | SettledStatus;

const STATUS_STYLES: Record<AnyStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "text-emerald-300 border-emerald-700/50" },
  won: { label: "Won", cls: "text-[#7CF0BE] border-[#7CF0BE]/40" },
  lost: { label: "Lost", cls: "text-red-300/80 border-red-900/50" },
  void: { label: "Void", cls: "text-emerald-200/50 border-emerald-900/50" },
  cashed_out: { label: "Cashed out", cls: "text-amber-300/80 border-amber-800/40" },
};

type Offer = {
  id: string;
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
  status: AnyStatus;
  cashout_value: number | null;
  cashout_estimate: number | null;
  placed_at: string;
  settled_at: string | null;
  group_name: string;
  legs: ParlayLeg[];
};

type SeasonPick = {
  id: string;
  group_season_id: string;
  selection_key: string;
  stake: number;
  decimal_odds: number;
  potential_return: number;
  status: AnyStatus;
  cashout_value: number | null;
  cashout_estimate: number | null;
  placed_at: string;
  settled_at: string | null;
  market_label: string;
  selection_label: string;
  season_name: string;
  group_name: string;
};

const LEG_DOT: Record<ParlayLeg["status"], string> = {
  open: "bg-emerald-200/30",
  won: "bg-emerald-400",
  lost: "bg-red-400",
  void: "bg-amber-300/60",
};

/** Singles, accas and season picks interleave in one list, newest first. */
type Item =
  | { kind: "single"; placedAt: string; pick: Pick }
  | { kind: "acca"; placedAt: string; parlay: Parlay }
  | { kind: "season"; placedAt: string; seasonPick: SeasonPick };

/** What the cash-out drawer needs, whichever kind it's quoting. */
type CashoutTarget = {
  kind: "single" | "acca" | "season";
  id: string;
  title: string;
  subtitle: string;
};

/** Shared status pill. */
function StatusBadge({ status }: { status: AnyStatus }) {
  const badge = STATUS_STYLES[status];
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badge.cls}`}
    >
      {badge.label}
    </span>
  );
}

/** Shared right-aligned outcome / potential-return line. */
function outcomeLine(
  status: AnyStatus,
  potentialReturn: number,
  cashoutValue: number | null,
  stake: number
): string {
  if (status === "won") return `+${potentialReturn} pts`;
  if (status === "cashed_out" && cashoutValue != null) return `+${cashoutValue} pts`;
  if (status === "void") return "stake returned";
  if (status === "lost") return `−${stake} pts`;
  return `returns ${potentialReturn} pts`;
}

/** Shared cash-out button — shows the live on-book value when we have one. */
function CashoutButton({ estimate, onClick }: { estimate: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 w-full py-1.5 rounded-full border border-amber-800/50 text-[11px] font-semibold text-amber-300/90 hover:bg-amber-900/20"
    >
      {estimate != null ? `Cash out — ${estimate} pts` : "Cash out"}
    </button>
  );
}

export default function MyPicksClient() {
  const router = useRouter();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [parlays, setParlays] = useState<Parlay[]>([]);
  const [seasonPicks, setSeasonPicks] = useState<SeasonPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "settled">("open");
  // Cash-out drawer
  const [cashoutTarget, setCashoutTarget] = useState<CashoutTarget | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [cashoutSuccess, setCashoutSuccess] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPicks = useCallback(async () => {
    const session = await requireViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    // One request, not three: the server resolves auth once and prices singles
    // and accas off a single placement context per event.
    const res = await fetch("/api/fantasy/my-picks", { headers });
    if (!res.ok) return;
    const j = await res.json();
    setPicks(j.picks ?? []);
    setParlays(j.parlays ?? []);
    setSeasonPicks(j.seasonPicks ?? []);
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

  const items: Item[] = [
    ...picks.map((pick) => ({ kind: "single" as const, placedAt: pick.placed_at, pick })),
    ...parlays.map((parlay) => ({ kind: "acca" as const, placedAt: parlay.placed_at, parlay })),
    ...seasonPicks.map((seasonPick) => ({ kind: "season" as const, placedAt: seasonPick.placed_at, seasonPick })),
  ].sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
  const statusOf = (item: Item): AnyStatus =>
    item.kind === "single" ? item.pick.status : item.kind === "acca" ? item.parlay.status : item.seasonPick.status;
  const openItems = items.filter((i) => statusOf(i) === "open");
  const settledItems = items.filter((i) => statusOf(i) !== "open");
  const shown = tab === "open" ? openItems : settledItems;

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

  const quotePath = (target: CashoutTarget) =>
    target.kind === "single"
      ? `/api/fantasy/picks/${target.id}/cashout`
      : target.kind === "acca"
      ? `/api/fantasy/parlays/${target.id}/cashout`
      : `/api/fantasy/seasons/picks/${target.id}/cashout`;

  const requestQuote = async (target: CashoutTarget) => {
    setQuoting(true);
    setCashoutError(null);
    setOffer(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(quotePath(target), {
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

  const openCashout = (target: CashoutTarget) => {
    setCashoutTarget(target);
    setCashoutSuccess(null);
    setCashoutError(null);
    setOffer(null);
    requestQuote(target);
  };

  const closeCashout = () => {
    setCashoutTarget(null);
    setOffer(null);
    stopCountdown();
  };

  const handleAccept = async () => {
    if (!offer || !cashoutTarget) return;
    setAccepting(true);
    setCashoutError(null);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const acceptPath =
        cashoutTarget.kind === "season"
          ? `/api/fantasy/seasons/cashout/${offer.id}/accept`
          : `/api/fantasy/cashout/${offer.id}/accept`;
      const res = await fetch(acceptPath, {
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

  const renderSingle = (p: Pick) => (
    <div
      key={`pick-${p.id}`}
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
          <StatusBadge status={p.status} />
        </div>
        <div className="text-[10px] text-emerald-200/50 truncate">
          {p.market_label} · {p.event_name}{p.group_name ? ` · ${p.group_name}` : ""}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-emerald-200/60">
            {p.stake} pts @ <OddsValue odds={Number(p.decimal_odds)} />
          </span>
          <span className="text-[11px] font-bold text-[#7CF0BE]">
            {outcomeLine(p.status, p.potential_return, p.cashout_value, p.stake)}
          </span>
        </div>
      </button>
      {p.status === "open" && p.event_status !== "completed" && (
        <CashoutButton
          estimate={p.cashout_estimate}
          onClick={() =>
            openCashout({
              kind: "single",
              id: p.id,
              title: p.selection_label,
              subtitle: `${p.market_label} · staked ${p.stake} pts, returns ${p.potential_return} pts`,
            })
          }
        />
      )}
    </div>
  );

  const renderAcca = (parlay: Parlay) => (
    <div
      key={`acca-${parlay.id}`}
      className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5"
    >
      <div className="flex items-center justify-between mb-0.5">
        <div className="text-[13px] font-semibold text-emerald-50">
          {parlay.legs.length}-leg {COMBO_BET.short}
        </div>
        <StatusBadge status={parlay.status} />
      </div>
      {parlay.group_name && (
        <div className="text-[10px] text-emerald-200/50 truncate mb-1.5">{parlay.group_name}</div>
      )}
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
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-emerald-200/60">
          {parlay.stake} pts @ <OddsValue odds={parlay.combined_decimal_odds} />
        </span>
        <span className="text-[11px] font-bold text-[#7CF0BE]">
          {outcomeLine(parlay.status, parlay.potential_return, parlay.cashout_value, parlay.stake)}
        </span>
      </div>
      {parlay.status === "open" && (
        <CashoutButton
          estimate={parlay.cashout_estimate}
          onClick={() =>
            openCashout({
              kind: "acca",
              id: parlay.id,
              title: `${parlay.legs.length}-leg ${COMBO_BET.short}`,
              subtitle: `staked ${parlay.stake} pts, returns ${parlay.potential_return} pts`,
            })
          }
        />
      )}
    </div>
  );

  const renderSeason = (s: SeasonPick) => (
    <div
      key={`season-${s.id}`}
      className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-2.5"
    >
      <button
        type="button"
        onClick={() => router.push(`/majors/fantasy/seasons/${s.group_season_id}`)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between mb-0.5">
          <div className="text-[13px] font-semibold text-emerald-50 truncate pr-2">
            {s.selection_label}
          </div>
          <StatusBadge status={s.status} />
        </div>
        <div className="text-[10px] text-emerald-200/50 truncate">
          {s.market_label} · {s.season_name}{s.group_name ? ` · ${s.group_name}` : ""}
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-emerald-200/60">
            {s.stake} pts @ <OddsValue odds={Number(s.decimal_odds)} />
          </span>
          <span className="text-[11px] font-bold text-[#7CF0BE]">
            {outcomeLine(s.status, s.potential_return, s.cashout_value, s.stake)}
          </span>
        </div>
      </button>
      {s.status === "open" && (
        <CashoutButton
          estimate={s.cashout_estimate}
          onClick={() =>
            openCashout({
              kind: "season",
              id: s.id,
              title: s.selection_label,
              subtitle: `${s.market_label} · staked ${s.stake} pts, returns ${s.potential_return} pts`,
            })
          }
        />
      )}
    </div>
  );

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
        <h1 className="text-lg font-bold tracking-wide text-[#7CF0BE]">My Picks</h1>
        <div className="w-12" />
      </div>

      <div className="px-4 mb-4 flex gap-2">
        {(["open", "settled"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              tab === t ? "bg-emerald-700 text-white" : "border border-emerald-900/60 text-emerald-200/70"
            }`}
          >
            {t === "open" ? `Open (${openItems.length})` : `Settled (${settledItems.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : shown.length === 0 ? (
        <div className="px-4">
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 px-4 py-6 text-center text-sm text-emerald-100/70">
            {tab === "open" ? "No open picks — find an event and back someone." : "No settled picks yet."}
          </div>
        </div>
      ) : (
        <div className="px-4 space-y-2 pb-12">
          {shown.map((item) =>
            item.kind === "single"
              ? renderSingle(item.pick)
              : item.kind === "acca"
              ? renderAcca(item.parlay)
              : renderSeason(item.seasonPick)
          )}
        </div>
      )}

      {/* Cash-out drawer */}
      {cashoutTarget && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end">
            <button
              type="button"
              aria-label="Close"
              onClick={closeCashout}
              className="absolute inset-0 bg-black/60"
            />
            <div className="relative w-full max-w-sm mx-auto rounded-t-3xl border border-emerald-900/70 bg-[#07301a] px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              <div className="text-sm font-bold text-[#7CF0BE] mb-0.5 truncate">
                {cashoutTarget.title}
              </div>
              <div className="text-[11px] text-emerald-200/60 mb-4 truncate">
                {cashoutTarget.subtitle}
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
                    <div className="text-3xl font-bold text-[#7CF0BE]">{offer.offer_value} pts</div>
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
                    {cashoutTarget.kind === "acca" ? `Keep my ${COMBO_BET.short}` : "Keep my pick"}
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
                    onClick={() => requestQuote(cashoutTarget)}
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

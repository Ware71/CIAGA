"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { HoleDetail, ApproachMissV, ApproachMissH } from "@/lib/rounds/hooks/useRoundDetail";
import { EMPTY_HOLE_DETAIL } from "@/lib/rounds/hooks/useRoundDetail";
import {
  APPROACH_CELL_ARIA,
  APPROACH_CELL_ARROW,
  APPROACH_CELL_LABEL,
  APPROACH_CELL_ORDER,
  APPROACH_CELL_VALUES,
} from "@/lib/stats/shotTracking";
import { DirectionArrow } from "@/components/ui/DirectionArrow";

/**
 * Optional per-hole shot tracking, rendered above the score entry sheet.
 *
 * Everything here is opt-in. A hole can be completed without touching a single
 * chip, and tapping a lit chip clears it back to "not recorded" (null) — which is
 * a different thing from a recorded zero. Nothing is ever defaulted on write;
 * the stats layer decides what an absent value means (see lib/stats/shotTracking).
 *
 * Rows run least-tapped to most-tapped top-to-bottom, so putts — the field
 * players actually keep up — sits directly above the score pad.
 */

const OPEN_KEY = "ciaga:round:hole-detail-open";

/** Highest value the round_hole_details check constraints allow. */
const MAX_PUTTS = 10;
const MAX_PENALTIES = 10;

/** Putts at or above this get the typed-entry chip instead of their own chip. */
const PUTTS_CHIP_MAX = 3;

/**
 * Show/hide is remembered across holes and sessions so a player who doesn't care
 * about shot tracking closes it once and never sees it again. Same shape as the
 * odds-format preference (components/fantasy/OddsValue.tsx): default on first
 * render, hydrate from localStorage in an effect to avoid an SSR mismatch.
 */
function useDetailPanelOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpenState] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw === "1") setOpenState(true);
    } catch {}
  }, []);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {}
  }, []);

  return [open, setOpen];
}

const CHIP_BASE =
  "h-9 px-3 rounded-xl border text-[12px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed";
const CHIP_OFF =
  "border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]";
const CHIP_ON = "border-[color:var(--sec-accent)] bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]";

function Chip({
  active,
  label,
  ariaLabel,
  onClick,
  disabled,
  className = "",
}: {
  active: boolean;
  label: React.ReactNode;
  ariaLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      disabled={disabled}
      onClick={onClick}
      className={`${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF} ${className}`}
    >
      {label}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-[58px] shrink-0 text-[9px] uppercase tracking-[0.12em] font-bold text-[color:var(--sec-muted)]">
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** Short human summary of what's recorded, shown on the collapsed bar. */
function summarise(d: HoleDetail): string {
  const bits: string[] = [];
  if (d.putts != null) bits.push(`${d.putts} putt${d.putts === 1 ? "" : "s"}`);
  if (d.fairway) bits.push(d.fairway === "hit" ? "FW hit" : `FW ${d.fairway}`);
  if (d.approach_green === true) bits.push("green");
  else if (d.approach_green === false) {
    const miss = [d.approach_miss_v, d.approach_miss_h].filter(Boolean).join(" ");
    bits.push(miss ? `missed ${miss}` : "missed green");
  }
  if (d.bunker) bits.push("bunker");
  if (d.penalties != null && d.penalties > 0) bits.push(`${d.penalties} pen`);
  return bits.join(" · ");
}

/**
 * The nine approach cells, laid out as a dispersion target: long across the top,
 * short across the bottom, the green in the middle. Each cell is one exact
 * (vertical, horizontal) combination of the two miss columns, so a corner is a
 * single tap rather than two.
 *
 * Order, labels and column values are shared with the stats page's heat grid so
 * the two read identically.
 */
const APPROACH_CELLS = APPROACH_CELL_ORDER.map((id) => ({
  id,
  v: APPROACH_CELL_VALUES[id].v as ApproachMissV | null,
  h: APPROACH_CELL_VALUES[id].h as ApproachMissH | null,
  label: APPROACH_CELL_LABEL[id],
  arrow: APPROACH_CELL_ARROW[id],
  aria: APPROACH_CELL_ARIA[id],
}));

type ApproachCellSpec = (typeof APPROACH_CELLS)[number];

export default function HoleDetailPanel({
  detail,
  holeNumber,
  par,
  disabled,
  onChange,
}: {
  detail: HoleDetail | null;
  holeNumber: number;
  par: number | null;
  disabled?: boolean;
  onChange: (next: HoleDetail) => void;
}) {
  const [open, setOpen] = useDetailPanelOpen();
  const [puttsEntry, setPuttsEntry] = useState<string | null>(null); // non-null = typed entry open
  const d = detail ?? EMPTY_HOLE_DETAIL;

  // FIR is undefined on a par 3, so the fairway row is hidden there. When par is
  // unknown (no hole snapshot) the row is shown rather than silently dropped.
  const showFairway = par !== 3;

  const summary = useMemo(() => summarise(d), [d]);

  // Close the typed putts entry when the sheet moves to another hole.
  useEffect(() => {
    setPuttsEntry(null);
  }, [holeNumber]);

  const patch = (p: Partial<HoleDetail>) => onChange({ ...d, ...p });

  // Every setter toggles: tapping the lit control returns the field to null.
  const setPutts = (n: number) => patch({ putts: d.putts === n ? null : n });
  const setFairway = (v: "hit" | "left" | "right") => patch({ fairway: d.fairway === v ? null : v });
  const toggleBunker = () => patch({ bunker: d.bunker ? null : true });

  // A penalty is only ever reached for when one happened, so the first (+) skips
  // straight to 1. 0 is reachable only by stepping down, and stepping down from
  // 0 clears the field back to "not recorded".
  const bumpPenalties = (delta: 1 | -1) => {
    if (delta === 1) {
      const next = d.penalties == null ? 1 : Math.min(d.penalties + 1, MAX_PENALTIES);
      patch({ penalties: next });
      return;
    }
    if (d.penalties == null) return;
    patch({ penalties: d.penalties <= 0 ? null : d.penalties - 1 });
  };

  const setApproach = (v: ApproachMissV | null, h: ApproachMissH | null) => {
    const isGreen = v == null && h == null;
    const alreadyActive = isGreen
      ? d.approach_green === true
      : d.approach_green === false && d.approach_miss_v === v && d.approach_miss_h === h;

    if (alreadyActive) {
      patch({ approach_green: null, approach_miss_v: null, approach_miss_h: null });
      return;
    }
    patch({ approach_green: isGreen, approach_miss_v: v, approach_miss_h: h });
  };

  const approachActive = (cell: ApproachCellSpec) =>
    cell.v == null && cell.h == null
      ? d.approach_green === true
      : d.approach_green === false && d.approach_miss_v === cell.v && d.approach_miss_h === cell.h;

  const commitPuttsEntry = () => {
    const n = parseInt(puttsEntry ?? "", 10);
    if (Number.isFinite(n)) patch({ putts: Math.max(0, Math.min(n, MAX_PUTTS)) });
    setPuttsEntry(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_95%,transparent)] px-3 py-2 shadow-2xl flex items-center gap-2 text-left hover:bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] transition-colors"
      >
        <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-[color:var(--sec-muted)] shrink-0">
          Shot tracking
        </span>
        <span className="flex-1 min-w-0 truncate text-[11px] font-semibold text-[color:var(--sec-muted)]">
          {summary || "Optional — putts, fairway, approach…"}
        </span>
        <span className="text-[11px] font-extrabold text-[color:var(--sec-muted)] shrink-0">Show</span>
      </button>
    );
  }

  const puttsOverflow = d.putts != null && d.putts > PUTTS_CHIP_MAX;

  return (
    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_95%,transparent)] p-3 shadow-2xl">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[9px] uppercase tracking-[0.14em] font-bold text-[color:var(--sec-muted)]">
          Shot tracking · Hole {holeNumber}
        </div>
        <button
          type="button"
          aria-expanded
          onClick={() => setOpen(false)}
          className="rounded-lg border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-2 py-1 text-[11px] font-extrabold text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]"
        >
          Hide
        </button>
      </div>

      <div className="space-y-1.5">
        {/* Bunker + penalties share a row: both are rare, both are one tap.
            Equal halves — a binary toggle shouldn't outweigh the control that
            actually carries a number. */}
        <Row label="Bunker">
          <div className="grid grid-cols-2 gap-1">
            <Chip
              active={d.bunker === true}
              label="Bunker"
              ariaLabel="In a bunker"
              onClick={toggleBunker}
              disabled={disabled}
            />

            <div className="flex items-center gap-1">
              <div className="text-[9px] uppercase tracking-[0.12em] font-bold text-[color:var(--sec-muted)] shrink-0">
                Pen
              </div>
              <button
                type="button"
                aria-label="One fewer penalty stroke"
                disabled={disabled || d.penalties == null}
                onClick={() => bumpPenalties(-1)}
                className={`${CHIP_BASE} ${CHIP_OFF} flex-1 px-0 text-[15px]`}
              >
                −
              </button>
              <div
                aria-label={`${d.penalties ?? "no"} penalty strokes recorded`}
                className={`w-7 shrink-0 text-center text-[13px] font-extrabold tabular-nums ${
                  d.penalties != null && d.penalties > 0 ? "text-[color:var(--sec-accent)]" : "text-[color:var(--sec-muted)]"
                }`}
              >
                {d.penalties ?? "–"}
              </div>
              <button
                type="button"
                aria-label="One more penalty stroke"
                disabled={disabled || (d.penalties != null && d.penalties >= MAX_PENALTIES)}
                onClick={() => bumpPenalties(1)}
                className={`${CHIP_BASE} ${CHIP_OFF} flex-1 px-0 text-[15px]`}
              >
                +
              </button>
            </div>
          </div>
        </Row>

        {showFairway ? (
          <Row label="Fairway">
            <div className="grid grid-cols-3 gap-1">
              <Chip active={d.fairway === "left"} label="◄ Left" ariaLabel="Fairway missed left" onClick={() => setFairway("left")} disabled={disabled} />
              <Chip active={d.fairway === "hit"} label="Hit" ariaLabel="Fairway hit" onClick={() => setFairway("hit")} disabled={disabled} />
              <Chip active={d.fairway === "right"} label="Right ►" ariaLabel="Fairway missed right" onClick={() => setFairway("right")} disabled={disabled} />
            </div>
          </Row>
        ) : null}

        {/* Full width on the same 3-column rhythm as Fairway, so the columns
            line up and every row shares one left and right edge. */}
        <Row label="Approach">
          <div className="grid grid-cols-3 gap-1">
            {APPROACH_CELLS.map((cell) => (
              <Chip
                key={cell.id}
                active={approachActive(cell)}
                label={cell.label ?? <DirectionArrow dir={cell.arrow!} />}
                ariaLabel={cell.aria}
                onClick={() => setApproach(cell.v, cell.h)}
                disabled={disabled}
                className="px-1"
              />
            ))}
          </div>
        </Row>

        <Row label="Putts">
          {puttsEntry != null ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Number of putts"
                value={puttsEntry}
                onChange={(e) => setPuttsEntry(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitPuttsEntry();
                  if (e.key === "Escape") setPuttsEntry(null);
                }}
                className="h-9 w-14 rounded-xl bg-[color:var(--ciaga-ground)] border border-[color:var(--sec-hair)] px-2 text-center text-[13px] font-extrabold tabular-nums text-[color:var(--sec-text)] outline-none"
              />
              <Chip active label="Set" onClick={commitPuttsEntry} disabled={disabled} className="flex-1" />
              <Chip
                active={false}
                label="Clear"
                ariaLabel="Clear putts"
                onClick={() => {
                  patch({ putts: null });
                  setPuttsEntry(null);
                }}
                disabled={disabled}
              />
              <Chip active={false} label="Back" onClick={() => setPuttsEntry(null)} disabled={disabled} />
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-1">
              {[0, 1, 2, 3].map((n) => (
                <Chip
                  key={n}
                  active={d.putts === n}
                  label={String(n)}
                  ariaLabel={
                    n === 0 ? "0 putts (holed from off the green)" : n === 1 ? "1 putt" : `${n} putts`
                  }
                  onClick={() => setPutts(n)}
                  disabled={disabled}
                />
              ))}
              {/* Shows the stored value once it's past the chips, so a 6-putt
                  hole reads "6" rather than a generic "4+". */}
              <Chip
                active={puttsOverflow}
                label={puttsOverflow ? String(d.putts) : "4+"}
                ariaLabel={puttsOverflow ? `${d.putts} putts, tap to edit` : "4 or more putts, tap to type"}
                onClick={() => setPuttsEntry(puttsOverflow ? String(d.putts) : "4")}
                disabled={disabled}
              />
            </div>
          )}
        </Row>
      </div>
    </div>
  );
}

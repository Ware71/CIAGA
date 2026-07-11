"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { SegmentedControl } from "@/components/calendar/SegmentedControl";
import { formatOdds, ODDS_FORMATS, type OddsFormat } from "@/lib/fantasy/oddsFormat";

/**
 * Odds display preference — per-device (localStorage), synced across all
 * mounted components via a window event so the header toggle updates every
 * odds button at once.
 */

const KEY = "ciaga:fantasy:odds-format";
const EVENT = "fantasy:odds-format-changed";

function isFormat(v: unknown): v is OddsFormat {
  return v === "decimal" || v === "fractional" || v === "american";
}

export function useOddsFormat(): [OddsFormat, (f: OddsFormat) => void] {
  const [format, setFormat] = useState<OddsFormat>("decimal");

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (isFormat(v)) setFormat(v);
    } catch {
      // Private browsing etc. — stay on decimal.
    }
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (isFormat(detail)) setFormat(detail);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const update = useCallback((f: OddsFormat) => {
    setFormat(f);
    try {
      window.localStorage.setItem(KEY, f);
    } catch {
      // Non-persistent is fine; the event still updates this session.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: f }));
  }, []);

  return [format, update];
}

/** Every odds number in the fantasy UI renders through this. */
export function OddsValue({ odds, className }: { odds: number; className?: string }) {
  const [format] = useOddsFormat();
  return <span className={className}>{formatOdds(odds, format)}</span>;
}

/** The Decimal / Fractional / American pill toggle. */
export function OddsFormatToggle({ className }: { className?: string }) {
  const [format, setFormat] = useOddsFormat();
  return (
    <SegmentedControl
      options={ODDS_FORMATS.map((f) => ({ value: f.id, label: f.label }))}
      value={format}
      onChange={setFormat}
      size="sm"
      className={className}
    />
  );
}

/** Subtle odds-format control — a small icon + dropdown for a board header. */
export function OddsFormatMenu({ className }: { className?: string }) {
  const [format, setFormat] = useOddsFormat();
  const [open, setOpen] = useState(false);
  const current = ODDS_FORMATS.find((f) => f.id === format)?.label ?? "Odds";
  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Odds format"
        className="flex items-center gap-1 rounded-full border border-emerald-800/50 px-2 py-1 text-[10px] font-semibold text-emerald-100/70 hover:text-emerald-50"
      >
        <SlidersHorizontal className="h-3 w-3" />
        {current}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-32 overflow-hidden rounded-xl border border-emerald-800/60 bg-[#07301a] shadow-xl">
            {ODDS_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFormat(f.id);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left text-[11px] ${
                  format === f.id
                    ? "bg-emerald-800/40 text-[#f5e6b0]"
                    : "text-emerald-100/80 hover:bg-emerald-900/40"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

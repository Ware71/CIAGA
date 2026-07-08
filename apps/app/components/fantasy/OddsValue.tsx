"use client";

import { useCallback, useEffect, useState } from "react";
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

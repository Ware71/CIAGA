"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The bet slip — multi-selection, persisted per device (localStorage) so
 * legs survive navigation between event boards (cross-event accas), synced
 * across mounted components via a window event (same pattern as the odds
 * format preference).
 */

export type SlipLeg = {
  marketId: string;
  selectionKey: string;
  snapshotId: string;
  decimalOdds: number;
  eventId: string;
  eventName: string;
  groupId: string;
  marketLabel: string;
  selectionLabel: string;
  subjectKeys: string[];
};

const KEY = "ciaga:fantasy:slip";
const EVENT = "fantasy:slip-changed";

function readLegs(): SlipLeg[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLegs(legs: SlipLeg[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(legs));
  } catch {
    // Non-persistent is fine; the event still updates this session.
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

function legMatches(a: SlipLeg, marketId: string, selectionKey: string): boolean {
  return a.marketId === marketId && a.selectionKey === selectionKey;
}

export function useSlip() {
  const [legs, setLegs] = useState<SlipLeg[]>([]);

  useEffect(() => {
    setLegs(readLegs());
    const onChange = () => setLegs(readLegs());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const toggle = useCallback((leg: SlipLeg) => {
    const current = readLegs();
    const existing = current.findIndex((l) => legMatches(l, leg.marketId, leg.selectionKey));
    if (existing >= 0) {
      current.splice(existing, 1);
    } else {
      // One selection per market in the slip — replace a sibling selection.
      const sibling = current.findIndex((l) => l.marketId === leg.marketId);
      if (sibling >= 0) current.splice(sibling, 1);
      current.push(leg);
    }
    writeLegs(current);
  }, []);

  const remove = useCallback((marketId: string, selectionKey: string) => {
    writeLegs(readLegs().filter((l) => !legMatches(l, marketId, selectionKey)));
  }, []);

  const clear = useCallback(() => writeLegs([]), []);

  const has = useCallback(
    (marketId: string, selectionKey: string) =>
      legs.some((l) => legMatches(l, marketId, selectionKey)),
    [legs]
  );

  return { legs, toggle, remove, clear, has };
}

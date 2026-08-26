import { describe, expect, it } from "vitest";
import { eventDateRange, formatEventDateRange, isMultiDay } from "@/lib/majors/eventDates";

const r = (scheduled_date: string | null, status?: string) => ({ scheduled_date, status });

describe("eventDateRange", () => {
  it("falls back to the event date when no round is dated", () => {
    expect(eventDateRange("2026-09-12", [r(null), r(null)])).toEqual({
      start: "2026-09-12",
      end: "2026-09-12",
    });
  });

  it("spans the dated rounds", () => {
    expect(eventDateRange("2026-09-12", [r("2026-09-12"), r("2026-09-13")])).toEqual({
      start: "2026-09-12",
      end: "2026-09-13",
    });
  });

  it("keeps an event date that precedes every round", () => {
    expect(eventDateRange("2026-09-11", [r("2026-09-12"), r("2026-09-13")]).start).toBe(
      "2026-09-11",
    );
  });

  it("ignores cancelled rounds", () => {
    expect(eventDateRange("2026-09-12", [r("2026-09-12"), r("2026-09-20", "cancelled")])).toEqual({
      start: "2026-09-12",
      end: "2026-09-12",
    });
  });

  it("handles no dates at all", () => {
    expect(eventDateRange(null, [])).toEqual({ start: null, end: null });
  });

  it("is order-independent", () => {
    expect(eventDateRange(null, [r("2026-09-13"), r("2026-09-12")])).toEqual({
      start: "2026-09-12",
      end: "2026-09-13",
    });
  });
});

describe("isMultiDay", () => {
  it("is false for a single day", () => {
    expect(isMultiDay("2026-09-12", [r("2026-09-12"), r("2026-09-12")])).toBe(false);
  });

  it("is true across two days", () => {
    expect(isMultiDay("2026-09-12", [r("2026-09-12"), r("2026-09-13")])).toBe(true);
  });

  it("is false for a 36-hole one-day event", () => {
    // Two rounds, same date — the classic 36-hole day.
    expect(isMultiDay(null, [r("2026-09-12"), r("2026-09-12")])).toBe(false);
  });
});

describe("formatEventDateRange", () => {
  // Built from Intl rather than hard-coded: en-GB abbreviates September as
  // "Sept", and the exact form varies with the ICU version.
  const month = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  it("prints a single date plainly", () => {
    expect(formatEventDateRange("2026-09-12", [])).toBe(month("2026-09-12"));
  });

  it("says the month once within a month", () => {
    expect(formatEventDateRange(null, [r("2026-09-12"), r("2026-09-13")])).toBe(
      `12–${month("2026-09-13")}`,
    );
  });

  it("spells both months across a boundary", () => {
    expect(formatEventDateRange(null, [r("2026-09-30"), r("2026-10-01")])).toBe(
      `${month("2026-09-30")} – ${month("2026-10-01")}`,
    );
  });

  it("returns null with nothing to show", () => {
    expect(formatEventDateRange(null, [])).toBeNull();
  });
});

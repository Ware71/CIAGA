import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarDaysBetween,
  clamp,
  daysBetween,
  fmtDM,
  isoLocal,
  niceStep,
  parseISODateLocal,
  round1,
  startOfLocalDay,
} from "../chartMath";

describe("round1", () => {
  it("rounds halves away from zero, like Postgres round(numeric, 1)", () => {
    expect(round1(1.25)).toBe(1.3);
    expect(round1(-1.25)).toBe(-1.3); // Math.round would give -1.2
    expect(round1(1.24)).toBe(1.2);
    expect(round1(-1.24)).toBe(-1.2);
  });

  it("never produces negative zero", () => {
    expect(Object.is(round1(-0.04), 0)).toBe(true);
    expect(Object.is(round1(-0), 0)).toBe(true);
  });

  it("passes non-finite values through rather than inventing a number", () => {
    expect(round1(NaN)).toBeNaN();
    expect(round1(Infinity)).toBe(Infinity);
  });
});

describe("local date helpers", () => {
  it("round-trips a date string through local midnight", () => {
    for (const d of ["2026-01-01", "2026-06-15", "2026-08-23", "2026-12-31"]) {
      expect(isoLocal(parseISODateLocal(d))).toBe(d);
    }
  });

  it("parses to LOCAL midnight, not UTC midnight", () => {
    const d = parseISODateLocal("2026-08-23");
    expect(d.getHours()).toBe(0);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(23);
  });

  it("agrees with startOfLocalDay for the same calendar day", () => {
    const noon = new Date(2026, 7, 23, 12, 34, 56);
    expect(startOfLocalDay(noon).getTime()).toBe(parseISODateLocal("2026-08-23").getTime());
  });

  it("counts whole calendar days across a DST boundary", () => {
    // In a DST-observing zone the elapsed-time measure comes back an hour short.
    // These are Postgres `date` values, so calendar days are what is meant.
    const a = parseISODateLocal("2024-01-01");
    const b = parseISODateLocal("2024-04-30");
    expect(calendarDaysBetween(a, b)).toBe(120);

    for (let i = 0; i < 365; i++) {
      expect(calendarDaysBetween(a, addDays(a, i))).toBe(i);
    }
  });

  it("keeps daysBetween as the elapsed-time measure it is", () => {
    const a = parseISODateLocal("2024-01-01");
    expect(daysBetween(a, addDays(a, 10))).toBeCloseTo(10, 6);
  });
});

describe("fmtDM", () => {
  it("zero-pads day and month", () => {
    expect(fmtDM(parseISODateLocal("2026-01-05"))).toBe("05/01");
    expect(fmtDM(parseISODateLocal("2026-12-31"))).toBe("31/12");
  });
});

describe("clamp", () => {
  it("bounds on both sides", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("niceStep", () => {
  it("returns round-numbered intervals", () => {
    for (const span of [1, 7, 23, 140, 900, 5000]) {
      const step = niceStep(span, 5);
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
      // Roughly the requested number of ticks, never zero.
      expect(step).toBeGreaterThan(0);
      expect(span / step).toBeLessThan(20);
    }
  });
});

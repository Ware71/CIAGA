import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CUTOFF_DAYS,
  attendanceDecay,
  attendancePhase,
  computeAttendanceProbability,
  participationRate,
} from "@/lib/fantasy/attendance";

const DAY = 24 * 60 * 60 * 1000;
const eventDate = 100 * DAY;
const cutoff = eventDate - ATTENDANCE_CUTOFF_DAYS * DAY;
const windowStart = eventDate - 42 * DAY;

describe("participationRate", () => {
  it("uses the prior below the minimum sample", () => {
    expect(participationRate(0, 1)).toBe(0.5);
    expect(participationRate(2, 2)).toBe(0.5);
  });
  it("is events-played ÷ events-held, clamped to [0,1]", () => {
    expect(participationRate(3, 6)).toBeCloseTo(0.5, 9);
    expect(participationRate(8, 10)).toBeCloseTo(0.8, 9);
    expect(participationRate(20, 10)).toBe(1);
  });
});

describe("attendanceDecay", () => {
  it("is 1 at/before the window opens", () => {
    expect(attendanceDecay(windowStart - DAY, eventDate, windowStart)).toBe(1);
    expect(attendanceDecay(windowStart, eventDate, windowStart)).toBe(1);
  });
  it("is 0 at/after the cutoff", () => {
    expect(attendanceDecay(cutoff, eventDate, windowStart)).toBe(0);
    expect(attendanceDecay(cutoff + DAY, eventDate, windowStart)).toBe(0);
  });
  it("decays linearly through the window", () => {
    const mid = (windowStart + cutoff) / 2;
    expect(attendanceDecay(mid, eventDate, windowStart)).toBeCloseTo(0.5, 6);
  });
});

describe("attendancePhase", () => {
  it("classifies the timeline", () => {
    expect(attendancePhase(windowStart - DAY, eventDate, windowStart)).toBe("pre_open");
    expect(attendancePhase(windowStart + DAY, eventDate, windowStart)).toBe("open");
    expect(attendancePhase(cutoff + DAY, eventDate, windowStart)).toBe("closed");
  });
});

describe("computeAttendanceProbability", () => {
  it("confirmed entrants always attend", () => {
    expect(
      computeAttendanceProbability({ entered: true, participation: 0.1 }, cutoff + DAY, eventDate, windowStart)
    ).toBe(1);
  });
  it("pre-open members are fully eligible (no uncertainty yet)", () => {
    expect(
      computeAttendanceProbability({ entered: false, participation: 0.3 }, windowStart - DAY, eventDate, windowStart)
    ).toBe(1);
  });
  it("open members carry participation × decay", () => {
    const mid = (windowStart + cutoff) / 2;
    expect(
      computeAttendanceProbability({ entered: false, participation: 0.8 }, mid, eventDate, windowStart)
    ).toBeCloseTo(0.8 * 0.5, 4);
  });
  it("drops to 0 past the cutoff", () => {
    expect(
      computeAttendanceProbability({ entered: false, participation: 0.9 }, cutoff + DAY, eventDate, windowStart)
    ).toBe(0);
  });
});

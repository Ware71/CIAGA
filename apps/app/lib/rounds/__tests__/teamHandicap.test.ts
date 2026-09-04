import { describe, expect, it } from "vitest";
import {
  SINGLE_BALL_FORMATS,
  calcTeamHandicap,
  isSingleBallFormat,
  teamHandicapDescription,
} from "../teamHandicap";
import { TEAM_FORMATS } from "../formatScoring";

describe("isSingleBallFormat", () => {
  it("covers exactly scramble, greensomes and foursomes", () => {
    expect([...SINGLE_BALL_FORMATS].sort()).toEqual(["foursomes", "greensomes", "scramble"]);
  });

  /**
   * The distinction that matters: seven formats are scored as teams, but only
   * three give the team a handicap of its own. The other four have every player
   * off their own allowance.
   */
  it("is a strict subset of the team formats", () => {
    for (const f of SINGLE_BALL_FORMATS) expect(TEAM_FORMATS).toContain(f);
    expect(SINGLE_BALL_FORMATS.length).toBeLessThan(TEAM_FORMATS.length);
  });

  it("excludes the multi-ball team formats", () => {
    for (const f of ["pairs_stableford", "team_strokeplay", "team_stableford", "team_bestball"] as const) {
      expect(isSingleBallFormat(f)).toBe(false);
      expect(calcTeamHandicap(f, [10, 20])).toBeNull();
    }
  });

  it("has no team handicap for singles formats", () => {
    for (const f of ["strokeplay", "stableford", "matchplay"] as const) {
      expect(calcTeamHandicap(f, [10, 20])).toBeNull();
    }
  });
});

describe("calcTeamHandicap — scramble", () => {
  it("weights a pair 35% lowest + 15% highest", () => {
    // 10×0.35 + 20×0.15 = 3.5 + 3 = 6.5 → 7
    expect(calcTeamHandicap("scramble", [20, 10])).toBe(7);
  });

  it("weights a three 30/20/10", () => {
    // 8×0.3 + 12×0.2 + 20×0.1 = 2.4 + 2.4 + 2 = 6.8 → 7
    expect(calcTeamHandicap("scramble", [12, 20, 8])).toBe(7);
  });

  it("weights a four 25/20/15/10", () => {
    // 4×0.25 + 8×0.2 + 12×0.15 + 20×0.1 = 1 + 1.6 + 1.8 + 2 = 6.4 → 6
    expect(calcTeamHandicap("scramble", [20, 4, 12, 8])).toBe(6);
  });

  it("takes 35% of a lone player", () => {
    expect(calcTeamHandicap("scramble", [20])).toBe(7);
  });

  it("sorts before weighting, so member order cannot change the answer", () => {
    const a = calcTeamHandicap("scramble", [20, 4, 12, 8]);
    const b = calcTeamHandicap("scramble", [4, 8, 12, 20]);
    const c = calcTeamHandicap("scramble", [12, 20, 8, 4]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("ignores members beyond the fourth", () => {
    expect(calcTeamHandicap("scramble", [4, 8, 12, 20, 30])).toBe(
      calcTeamHandicap("scramble", [4, 8, 12, 20])
    );
  });
});

describe("calcTeamHandicap — greensomes and foursomes", () => {
  it("greensomes is 60% lowest + 40% highest", () => {
    // 10×0.6 + 20×0.4 = 6 + 8 = 14
    expect(calcTeamHandicap("greensomes", [20, 10])).toBe(14);
  });

  it("foursomes is 50% of the combined handicaps", () => {
    // (10 + 20) × 0.5 = 15
    expect(calcTeamHandicap("foursomes", [20, 10])).toBe(15);
  });

  /** A pair with one member doubles that player up rather than dropping them. */
  it("doubles a lone player up in the pair formats", () => {
    expect(calcTeamHandicap("greensomes", [10])).toBe(10);
    expect(calcTeamHandicap("foursomes", [10])).toBe(10);
  });
});

describe("calcTeamHandicap — edges", () => {
  it("returns null when nobody has a handicap", () => {
    expect(calcTeamHandicap("scramble", [])).toBeNull();
    expect(calcTeamHandicap("scramble", [null, undefined])).toBeNull();
  });

  it("skips missing handicaps rather than treating them as zero", () => {
    // Only the 10 counts, so this is the lone-player case, not 10 and 0.
    expect(calcTeamHandicap("scramble", [10, null])).toBe(4); // 10 × 0.35 = 3.5 → 4
  });

  it("handles plus handicaps", () => {
    // -2×0.35 + 6×0.15 = -0.7 + 0.9 = 0.2 → 0
    expect(calcTeamHandicap("scramble", [6, -2])).toBe(0);
  });
});

describe("teamHandicapDescription", () => {
  it("describes the weighting actually applied", () => {
    expect(teamHandicapDescription("scramble", 2)).toBe("35% lowest + 15% highest");
    expect(teamHandicapDescription("scramble", 3)).toBe("30% lowest + 20% second + 10% highest");
    expect(teamHandicapDescription("scramble", 4)).toContain("25% lowest");
    expect(teamHandicapDescription("greensomes", 2)).toBe("60% lowest + 40% highest");
    expect(teamHandicapDescription("foursomes", 2)).toBe("50% of the combined handicaps");
  });

  it("says nothing for a format without a team handicap", () => {
    expect(teamHandicapDescription("strokeplay", 2)).toBe("");
    expect(teamHandicapDescription("team_bestball", 2)).toBe("");
  });
});

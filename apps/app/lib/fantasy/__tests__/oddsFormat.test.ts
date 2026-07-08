import { describe, expect, it } from "vitest";
import { formatOdds, toAmerican, toFractional } from "@/lib/fantasy/oddsFormat";

describe("toFractional", () => {
  it("maps book-standard prices to their conventional fractions", () => {
    expect(toFractional(2.0)).toBe("1/1"); // evens
    expect(toFractional(2.5)).toBe("6/4"); // book convention, not 3/2
    expect(toFractional(3.5)).toBe("5/2");
    expect(toFractional(1.5)).toBe("1/2");
    expect(toFractional(11)).toBe("10/1");
    expect(toFractional(1.91)).toBe("10/11");
  });

  it("snaps in-between decimals to the nearest ladder rung", () => {
    expect(toFractional(1.53)).toBe("8/15"); // 0.533 profit
    expect(toFractional(4.33)).toBe("10/3");
  });

  it("handles the engine's odds caps", () => {
    expect(toFractional(1.01)).toBe("1/100");
    expect(toFractional(200)).toBe("200/1");
  });
});

describe("toAmerican", () => {
  it("underdogs are plus, favourites minus, evens +100", () => {
    expect(toAmerican(2.5)).toBe("+150");
    expect(toAmerican(2.0)).toBe("+100");
    expect(toAmerican(1.5)).toBe("-200");
    expect(toAmerican(1.91)).toBe("-110");
    expect(toAmerican(1.01)).toBe("-10000");
    expect(toAmerican(21)).toBe("+2000");
  });
});

describe("formatOdds", () => {
  it("routes by format", () => {
    expect(formatOdds(2.5, "decimal")).toBe("2.50");
    expect(formatOdds(2.5, "fractional")).toBe("6/4");
    expect(formatOdds(2.5, "american")).toBe("+150");
  });
});

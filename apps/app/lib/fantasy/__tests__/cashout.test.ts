import { describe, expect, it } from "vitest";
import { CASHOUT_DISCOUNT, computeCashoutValue } from "@/lib/fantasy/cashout";

describe("computeCashoutValue", () => {
  it("matches the spec worked example (stake 10 @ 8.00, p = 42%)", () => {
    // Potential return 80, fair value 33.60, offer 30.24.
    expect(computeCashoutValue(0.42, 80)).toBe(30.24);
  });

  it("applies the 0.90 MVP discount by default", () => {
    expect(CASHOUT_DISCOUNT).toBe(0.9);
    expect(computeCashoutValue(0.5, 100)).toBe(45);
  });

  it("rounds to 2dp", () => {
    expect(computeCashoutValue(0.333333, 30)).toBe(9);
    expect(computeCashoutValue(0.123456, 77)).toBe(8.56);
  });

  it("near-dead picks quote near zero (blocked upstream by the min-value guard)", () => {
    expect(computeCashoutValue(0.005, 1)).toBe(0);
  });
});

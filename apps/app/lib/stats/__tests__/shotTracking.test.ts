import { describe, expect, it } from "vitest";
import {
  approachCellOf,
  bunkerOf,
  computeShotTracking,
  girOf,
  isTrackedHole,
  lengthBand,
  penaltiesOf,
  siBand,
  type ShotRow,
} from "@/lib/stats/shotTracking";

function row(over: Partial<ShotRow> = {}): ShotRow {
  return {
    round_id: "r1",
    played_at: "2026-07-01T00:00:00Z",
    par: 4,
    yardage: 400,
    stroke_index: 5,
    strokes: null,
    putts: null,
    fairway: null,
    approach_green: null,
    approach_miss_v: null,
    approach_miss_h: null,
    bunker: null,
    penalties: null,
    ...over,
  };
}

describe("girOf", () => {
  it("derives GIR from putts, strokes and par", () => {
    // Par 4 in 4 with 2 putts: on the green in 2 = regulation.
    expect(girOf(row({ par: 4, strokes: 4, putts: 2 }))).toBe(true);
    // Par 4 in 4 with 1 putt: reached the green in 3 = missed.
    expect(girOf(row({ par: 4, strokes: 4, putts: 1 }))).toBe(false);
    // Par 5 in 6 with 2 putts: on in 4, regulation is 3 = missed.
    expect(girOf(row({ par: 5, strokes: 6, putts: 2 }))).toBe(false);
    // Par 3 in 3 with 2 putts: on in 1 = regulation.
    expect(girOf(row({ par: 3, strokes: 3, putts: 2 }))).toBe(true);
  });

  it("handles hole-outs from off the green on their merits", () => {
    // Par 4 holed in 2 with 0 putts: the approach went in, so the ball was in
    // the hole in regulation — a GIR.
    expect(girOf(row({ par: 4, strokes: 2, putts: 0 }))).toBe(true);
    // Par 4 chipped in for par: 3 shots to hole out is one worse than
    // regulation, so the green was missed however good the up-and-down was.
    expect(girOf(row({ par: 4, strokes: 3, putts: 0 }))).toBe(false);
  });

  it("refuses to derive anything when putts meet or exceed the score", () => {
    // Mistyped entry: 6 putts on a hole scored 5. Naively 5 - 6 = -1, which is
    // <= par - 2, so the bad data would read as a GIR.
    expect(girOf(row({ par: 3, strokes: 5, putts: 6 }))).toBeNull();
    // Equally impossible: every hole opens with a stroke that isn't a putt.
    expect(girOf(row({ par: 4, strokes: 4, putts: 4 }))).toBeNull();
    // One short of that boundary is legitimate data and must still compute:
    // a drivable par 4 reached in 1, then four-putted. Ugly, but a GIR.
    expect(girOf(row({ par: 4, strokes: 5, putts: 4 }))).toBe(true);
    expect(girOf(row({ par: 4, strokes: 6, putts: 2 }))).toBe(false);
  });

  it("returns null when any input is missing, so it is never inferred", () => {
    expect(girOf(row({ par: 4, strokes: 4, putts: null }))).toBeNull();
    expect(girOf(row({ par: 4, strokes: null, putts: 2 }))).toBeNull();
    expect(girOf(row({ par: null, strokes: 4, putts: 2 }))).toBeNull();
  });
});

describe("computeShotTracking denominators", () => {
  it("counts only holes where the input was actually recorded", () => {
    const rows = [
      row({ strokes: 4, putts: 2 }),
      row({ strokes: 5, putts: 2 }),
      row({ strokes: 4 }), // scored but nothing tracked
      row({ strokes: 6 }), // scored but nothing tracked
    ];

    const s = computeShotTracking(rows);

    expect(s.putting.overall.n).toBe(2);
    expect(s.putting.overall.avg).toBe(2);
    expect(s.coverage.putts.holes).toBe(2);
    expect(s.coverage.putts.rounds).toBe(1);
    // Untracked holes must not dilute GIR.
    expect(s.gir.overall.n).toBe(2);
  });

  it("reports a null rate rather than 0% when nothing qualifies", () => {
    const s = computeShotTracking([row({ strokes: 4 })]);
    expect(s.gir.overall.n).toBe(0);
    expect(s.gir.overall.rate).toBeNull();
    expect(s.putting.overall.avg).toBeNull();
    expect(s.anyData).toBe(false);
  });

  it("treats 0 putts as recorded data, not as absent", () => {
    const s = computeShotTracking([row({ strokes: 3, putts: 0 })]);
    expect(s.putting.overall.n).toBe(1);
    expect(s.putting.overall.avg).toBe(0);
    expect(s.putting.zero.rate).toBe(1);
    expect(s.anyData).toBe(true);
  });
});

describe("fairways", () => {
  it("excludes par 3s from FIR", () => {
    const rows = [
      row({ par: 3, fairway: "hit" }),
      row({ par: 4, fairway: "hit" }),
      row({ par: 4, fairway: "left" }),
      row({ par: 5, fairway: "right" }),
    ];

    const s = computeShotTracking(rows);

    expect(s.fir.overall.n).toBe(3);
    expect(s.fir.overall.hits).toBe(1);
    expect(s.fir.missLeft.hits).toBe(1);
    expect(s.fir.missRight.hits).toBe(1);
    // Coverage still records the par 3 tap; only the FIR metric drops it.
    expect(s.coverage.fairway.holes).toBe(4);
  });

  it("splits FIR by par, showing par 4 and par 5 separately", () => {
    const s = computeShotTracking([
      row({ par: 4, fairway: "hit" }),
      row({ par: 4, fairway: "left" }),
      row({ par: 5, fairway: "hit" }),
    ]);

    expect(s.fir.byPar).toEqual([
      { label: "Par 4", rate: { n: 2, hits: 1, rate: 0.5 } },
      { label: "Par 5", rate: { n: 1, hits: 1, rate: 1 } },
    ]);
  });
});

describe("approach dispersion", () => {
  it("counts a combination miss on both axes", () => {
    const s = computeShotTracking([
      row({ approach_green: false, approach_miss_v: "short", approach_miss_h: "left" }),
      row({ approach_green: true }),
    ]);

    expect(s.approach.n).toBe(2);
    expect(s.approach.green.hits).toBe(1);
    expect(s.approach.short.hits).toBe(1);
    expect(s.approach.left.hits).toBe(1);
    expect(s.approach.long.hits).toBe(0);
    expect(s.approach.right.hits).toBe(0);
  });

  it("maps every column triple onto its dispersion cell", () => {
    const cell = (v: any, h: any, green: boolean) =>
      approachCellOf(row({ approach_green: green, approach_miss_v: v, approach_miss_h: h }));

    expect(cell(null, null, true)).toBe("green");
    expect(cell("long", "left", false)).toBe("long_left");
    expect(cell("long", null, false)).toBe("long");
    expect(cell("long", "right", false)).toBe("long_right");
    expect(cell(null, "left", false)).toBe("left");
    expect(cell(null, "right", false)).toBe("right");
    expect(cell("short", "left", false)).toBe("short_left");
    expect(cell("short", null, false)).toBe("short");
    expect(cell("short", "right", false)).toBe("short_right");
    // Nothing tapped at all — no cell.
    expect(approachCellOf(row({}))).toBeNull();
  });

  it("tallies the grid so the nine cells sum to the recorded approaches", () => {
    const s = computeShotTracking([
      row({ approach_green: true }),
      row({ approach_green: true }),
      row({ approach_green: false, approach_miss_v: "short", approach_miss_h: "right" }),
      row({ approach_green: false, approach_miss_v: "long" }),
      row({}), // nothing recorded
    ]);

    expect(s.approach.grid.green).toBe(2);
    expect(s.approach.grid.short_right).toBe(1);
    expect(s.approach.grid.long).toBe(1);
    expect(s.approach.grid.long_left).toBe(0);

    const total = Object.values(s.approach.grid).reduce((a, b) => a + b, 0);
    expect(total).toBe(s.approach.n);
  });

  it("never feeds GIR — a tapped green with no putts leaves GIR unknown", () => {
    const s = computeShotTracking([row({ strokes: 4, approach_green: true })]);
    expect(s.approach.green.rate).toBe(1);
    expect(s.gir.overall.n).toBe(0);
  });
});

describe("scrambling and sand saves", () => {
  it("scrambles only over holes where the green was missed", () => {
    const rows = [
      row({ par: 4, strokes: 4, putts: 1 }), // missed green, made par → par save
      row({ par: 4, strokes: 5, putts: 1 }), // missed green, bogey → bogey save only
      row({ par: 4, strokes: 6, putts: 2 }), // missed green, double → neither
      row({ par: 4, strokes: 4, putts: 2 }), // GIR → not an opportunity
    ];

    const s = computeShotTracking(rows);

    expect(s.scrambling.parSave).toEqual({ n: 3, hits: 1, rate: 1 / 3 });
    expect(s.scrambling.bogeySave).toEqual({ n: 3, hits: 2, rate: 2 / 3 });
  });

  it("requires both a bunker and a missed green for a sand save opportunity", () => {
    const rows = [
      // In a bunker, missed the green, made par → a save.
      row({ par: 4, strokes: 4, putts: 1, bunker: true }),
      // In a bunker, missed the green, bogey → an opportunity, not a save.
      row({ par: 4, strokes: 5, putts: 1, bunker: true }),
      // Fairway bunker but the green was hit → not an opportunity at all.
      row({ par: 4, strokes: 4, putts: 2, bunker: true }),
      // Bunker with no putts recorded → GIR unknown, so no opportunity.
      row({ par: 4, strokes: 4, bunker: true }),
    ];

    const s = computeShotTracking(rows);

    expect(s.scrambling.sandSave).toEqual({ n: 2, hits: 1, rate: 0.5 });
    // All four holes are tracked and all four flagged a bunker, so the rate is
    // over the same four holes.
    expect(s.scrambling.bunkerHoles).toEqual({ n: 4, hits: 4, rate: 1 });
  });
});

describe("putts split by GIR", () => {
  it("separates putts on greens hit from greens missed", () => {
    const s = computeShotTracking([
      row({ par: 4, strokes: 4, putts: 2 }), // GIR
      row({ par: 4, strokes: 5, putts: 3 }), // GIR
      row({ par: 4, strokes: 4, putts: 1 }), // missed
    ]);

    expect(s.putting.onGir).toEqual({ n: 2, avg: 2.5 });
    expect(s.putting.offGir).toEqual({ n: 1, avg: 1 });
  });
});

describe("penalties", () => {
  it("totals penalties and counts holes carrying at least one", () => {
    // Each hole carries 2+ fields so it is tracked in its own right; the
    // penalty value is explicit on all three.
    const s = computeShotTracking([
      row({ putts: 2, fairway: "hit", penalties: 0 }),
      row({ putts: 2, fairway: "hit", penalties: 1 }),
      row({ putts: 2, fairway: "hit", penalties: 2 }),
    ]);

    expect(s.penalties.total).toBe(3);
    expect(s.penalties.overall.n).toBe(3);
    expect(s.penalties.holesWithPenalty).toEqual({ n: 3, hits: 2, rate: 2 / 3 });
    expect(s.penalties.per18).toBe(18);
  });
});

describe("tracked holes and implied zeros", () => {
  it("needs two recorded fields before a hole counts as tracked", () => {
    expect(isTrackedHole(row({}))).toBe(false);
    expect(isTrackedHole(row({ putts: 2 }))).toBe(false);
    expect(isTrackedHole(row({ putts: 2, fairway: "hit" }))).toBe(true);
    expect(isTrackedHole(row({ putts: 2, approach_green: true }))).toBe(true);
    // The event fields count toward the threshold too.
    expect(isTrackedHole(row({ bunker: true, penalties: 1 }))).toBe(true);
  });

  it("reads an untapped event field as zero only on a tracked hole", () => {
    const tracked = row({ putts: 2, fairway: "hit" });
    expect(penaltiesOf(tracked)).toBe(0);
    expect(bunkerOf(tracked)).toBe(false);

    const puttsOnly = row({ putts: 2 });
    expect(penaltiesOf(puttsOnly)).toBeNull();
    expect(bunkerOf(puttsOnly)).toBeNull();

    const untouched = row({});
    expect(penaltiesOf(untouched)).toBeNull();
    expect(bunkerOf(untouched)).toBeNull();
  });

  it("always prefers an explicit value over the inferred zero", () => {
    expect(penaltiesOf(row({ putts: 2, fairway: "hit", penalties: 2 }))).toBe(2);
    expect(bunkerOf(row({ putts: 2, fairway: "hit", bunker: true }))).toBe(true);
    // An explicit value on an untracked hole is still known.
    expect(penaltiesOf(row({ penalties: 1 }))).toBe(1);
  });

  it("excludes putts-only holes from the penalty and bunker denominators", () => {
    const s = computeShotTracking([
      row({ putts: 2, fairway: "hit" }), // tracked, no penalty tapped -> 0
      row({ putts: 2, fairway: "hit", penalties: 1 }), // tracked, explicit 1
      row({ putts: 2 }), // putts only -> not tracked, contributes nothing
      row({}), // nothing at all
    ]);

    expect(s.coverage.tracked.holes).toBe(2);
    expect(s.penalties.holesWithPenalty).toEqual({ n: 2, hits: 1, rate: 0.5 });
    expect(s.scrambling.bunkerHoles).toEqual({ n: 2, hits: 0, rate: 0 });

    // Coverage reports taps and inferences separately.
    expect(s.coverage.penalties.holes).toBe(1);
    expect(s.coverage.penalties.inferred).toBe(1);
    expect(s.coverage.bunker.holes).toBe(0);
    expect(s.coverage.bunker.inferred).toBe(2);
  });

  it("never invents a sand-save opportunity, since inference only yields false", () => {
    const rows = [
      // Tracked, green missed, no bunker tapped -> inferred false, so not an
      // opportunity even though every other condition is met.
      row({ par: 4, strokes: 4, putts: 1, fairway: "hit" }),
      // Same but the bunker was actually flagged.
      row({ par: 4, strokes: 4, putts: 1, fairway: "hit", bunker: true }),
    ];

    const s = computeShotTracking(rows);
    expect(s.scrambling.sandSave).toEqual({ n: 1, hits: 1, rate: 1 });
  });

  it("does not let an inferred zero make an untracked page look populated", () => {
    const s = computeShotTracking([row({ strokes: 4 }), row({ strokes: 5 })]);
    expect(s.anyData).toBe(false);
    expect(s.coverage.tracked.holes).toBe(0);
  });
});

describe("bands", () => {
  it("bands length relative to par", () => {
    expect(lengthBand(3, 130)).toBe("short");
    expect(lengthBand(3, 200)).toBe("long");
    expect(lengthBand(4, 340)).toBe("short");
    expect(lengthBand(4, 400)).toBe("mid");
    expect(lengthBand(5, 560)).toBe("long");
    expect(lengthBand(4, null)).toBeNull();
  });

  it("bands stroke index into thirds", () => {
    expect(siBand(1)).toBe("1-6");
    expect(siBand(7)).toBe("7-12");
    expect(siBand(18)).toBe("13-18");
    expect(siBand(null)).toBeNull();
    expect(siBand(19)).toBeNull();
  });

  it("builds breakdowns per par with independent denominators", () => {
    const s = computeShotTracking([
      row({ par: 3, strokes: 3, putts: 2 }),
      row({ par: 4, strokes: 4, putts: 2, fairway: "hit" }),
      row({ par: 4, strokes: 5, putts: 1, fairway: "left" }),
    ]);

    const par4 = s.breakdowns.byPar.find((b) => b.label === "Par 4")!;
    expect(par4.gir).toEqual({ n: 2, hits: 1, rate: 0.5 });
    expect(par4.fir).toEqual({ n: 2, hits: 1, rate: 0.5 });
    expect(par4.putts).toEqual({ n: 2, avg: 1.5 });

    const par3 = s.breakdowns.byPar.find((b) => b.label === "Par 3")!;
    // No fairway is recordable on a par 3, so that cell is empty rather than 0%.
    expect(par3.fir.rate).toBeNull();
  });
});

describe("multi-round coverage", () => {
  it("counts distinct rounds per stat", () => {
    const s = computeShotTracking([
      row({ round_id: "a", putts: 2, strokes: 4 }),
      row({ round_id: "a", putts: 2, strokes: 4 }),
      row({ round_id: "b", putts: 1, strokes: 4 }),
      row({ round_id: "c", fairway: "hit" }),
    ]);

    expect(s.coverage.putts).toEqual({ holes: 3, rounds: 2 });
    expect(s.coverage.fairway).toEqual({ holes: 1, rounds: 1 });
  });
});

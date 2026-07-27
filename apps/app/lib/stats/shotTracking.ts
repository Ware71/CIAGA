// Shot tracking stats, computed from the optional per-hole detail recorded
// during a round (round_hole_details, surfaced on the hole_scoring_source view).
//
// The governing rule: NOTHING IS INFERRED. Every metric counts only the holes
// where the player actually recorded the input it needs, and each carries its own
// `n` so the UI can show the sample size and render a dash instead of a fake 0%.
//
// GIR is derived from putts, never from the approach tap: `strokes - putts` is
// the number of shots taken to reach the green, so GIR is exactly
// `strokes - putts <= par - 2`. The tapped approach is only "the shot I hit at
// the green" - on a par 5 it may be the 2nd of three, on a par 4 the 3rd - so it
// cannot stand in for regulation. The approach field feeds the dispersion
// pattern and nothing else.

/**
 * Nullable number coercion. Deliberately NOT lib/stats/helpers.safeNum: that one
 * runs `Number(x)`, and `Number(null)` is 0 - so a hole with no putts recorded
 * would read as a recorded 0-putt hole and quietly poison every denominator here.
 */
function num(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export type ShotRow = {
  round_id?: string | null;
  played_at?: string | null;
  par: number | null;
  yardage: number | null;
  stroke_index: number | null;
  strokes: number | null;
  putts: number | null;
  fairway: "hit" | "left" | "right" | null;
  approach_green: boolean | null;
  approach_miss_v: "short" | "long" | null;
  approach_miss_h: "left" | "right" | null;
  bunker: boolean | null;
  penalties: number | null;
};

/** The nine approach dispersion cells, laid out as they appear in the grid. */
export type ApproachCell =
  | "long_left" | "long" | "long_right"
  | "left" | "green" | "right"
  | "short_left" | "short" | "short_right";

export const APPROACH_CELL_ORDER: ApproachCell[] = [
  "long_left", "long", "long_right",
  "left", "green", "right",
  "short_left", "short", "short_right",
];

/**
 * Shared so the input grid on the scorecard and the heat grid on the stats page
 * read identically. The five orthogonal cells carry a word; the four corners are
 * null and get an arrow instead — see APPROACH_CELL_ARROW.
 */
export const APPROACH_CELL_LABEL: Record<ApproachCell, string | null> = {
  long_left: null,
  long: "Long",
  long_right: null,
  left: "Left",
  green: "Green",
  right: "Right",
  short_left: null,
  short: "Short",
  short_right: null,
};

/**
 * Corner directions, rendered as inline SVG (components/ui/DirectionArrow).
 * Drawn rather than typed: the ↖ ↗ ↙ ↘ glyphs default to emoji presentation on
 * Windows and Android and render as colour pictographs.
 */
export const APPROACH_CELL_ARROW: Partial<Record<ApproachCell, "nw" | "ne" | "sw" | "se">> = {
  long_left: "nw",
  long_right: "ne",
  short_left: "sw",
  short_right: "se",
};

export const APPROACH_CELL_ARIA: Record<ApproachCell, string> = {
  long_left: "Approach missed long and left",
  long: "Approach missed long",
  long_right: "Approach missed long and right",
  left: "Approach missed left",
  green: "Approach found the green",
  right: "Approach missed right",
  short_left: "Approach missed short and left",
  short: "Approach missed short",
  short_right: "Approach missed short and right",
};

/** The column values each cell writes. */
export const APPROACH_CELL_VALUES: Record<
  ApproachCell,
  { v: "short" | "long" | null; h: "left" | "right" | null }
> = {
  long_left: { v: "long", h: "left" },
  long: { v: "long", h: null },
  long_right: { v: "long", h: "right" },
  left: { v: null, h: "left" },
  green: { v: null, h: null },
  right: { v: null, h: "right" },
  short_left: { v: "short", h: "left" },
  short: { v: "short", h: null },
  short_right: { v: "short", h: "right" },
};

/** A proportion with its denominator. `rate` is null when nothing qualifies. */
export type Rate = { n: number; hits: number; rate: number | null };

export type Avg = { n: number; avg: number | null };

export type Coverage = {
  holes: number;
  rounds: number;
  /**
   * Event fields only: holes that contributed a derived zero rather than a tap.
   * Not `tracked - holes` — a hole can carry an explicit tap and still fall below
   * the tracked threshold, so the two sets overlap only partially.
   */
  inferred?: number;
};

/**
 * How many shot-tracking fields the player explicitly recorded on a hole, and
 * whether that's enough to treat the hole as one they were actively tracking.
 *
 * Bunker and penalties are *event* fields: a player only taps them when the
 * event happened, so "not recorded" and "didn't happen" look identical in the
 * data, and any rate over them would be garbage. On a hole the player was
 * demonstrably tracking, an untapped event field is read as "didn't happen".
 *
 * The threshold is two fields, not one, on purpose: a putts-only tracker never
 * reaches it, so they are never shown a confident "0 penalties across 54 holes"
 * derived from data they never intended to give.
 *
 * This is a READ-TIME derivation. Nothing is ever defaulted on write — the
 * database still holds NULL, and the UI states the assumption.
 */
export const TRACKED_FIELD_MIN = 2;

export type Breakdown = {
  label: string;
  gir: Rate;
  fir: Rate;
  putts: Avg;
  scramble: Rate;
};

export type ShotTrackingStats = {
  anyData: boolean;
  coverage: {
    putts: Coverage;
    fairway: Coverage;
    approach: Coverage;
    /** Holes where a bunker was explicitly flagged. */
    bunker: Coverage;
    /** Holes where a penalty count was explicitly entered. */
    penalties: Coverage;
    gir: Coverage;
    /** Holes with >= TRACKED_FIELD_MIN fields, where an absent event field reads as zero. */
    tracked: Coverage;
  };
  putting: {
    overall: Avg;
    per18: number | null;
    zero: Rate;
    one: Rate;
    two: Rate;
    threePlus: Rate;
    onGir: Avg;
    offGir: Avg;
  };
  gir: { overall: Rate; byPar: { label: string; rate: Rate }[] };
  fir: { overall: Rate; missLeft: Rate; missRight: Rate; byPar: { label: string; rate: Rate }[] };
  approach: {
    n: number;
    green: Rate;
    short: Rate;
    long: Rate;
    left: Rate;
    right: Rate;
    /** Counts per dispersion cell; the nine sum to `n`. */
    grid: Record<ApproachCell, number>;
  };
  scrambling: { parSave: Rate; bogeySave: Rate; sandSave: Rate; bunkerHoles: Rate };
  penalties: { overall: Avg; per18: number | null; total: number; holesWithPenalty: Rate };
  breakdowns: { byPar: Breakdown[]; bySi: Breakdown[]; byLength: Breakdown[] };
};

export function rate(hits: number, n: number): Rate {
  return { n, hits, rate: n > 0 ? hits / n : null };
}

export function avg(values: number[]): Avg {
  if (!values.length) return { n: 0, avg: null };
  return { n: values.length, avg: values.reduce((a, b) => a + b, 0) / values.length };
}

/**
 * Green in regulation, derived from putts. Returns null when any input the
 * derivation needs is missing - the caller must treat that as "unknown", never
 * as a miss.
 */
export function girOf(row: ShotRow): boolean | null {
  const putts = num(row.putts);
  const strokes = num(row.strokes);
  const par = num(row.par);
  if (putts == null || strokes == null || par == null) return null;
  // Every hole starts with a stroke that isn't a putt, so putts can never reach
  // the stroke count. Anything at or above it is a mistyped entry, and
  // `strokes - putts` would collapse to <= 0 and read as a flattering GIR —
  // treat the hole as unknown rather than derive from bad data.
  if (putts >= strokes) return null;
  return strokes - putts <= par - 2;
}

/**
 * Coarse three-way length band, relative to par. Deliberately coarser than the
 * per-par buckets on the hole-scoring page: shot tracking is opt-in, so samples
 * are small and fine buckets would be mostly n=1.
 */
export function lengthBand(par: number | null, yardage: number | null): "short" | "mid" | "long" | null {
  const p = num(par);
  const y = num(yardage);
  if (p == null || y == null) return null;
  if (p <= 3) return y < 150 ? "short" : y < 190 ? "mid" : "long";
  if (p === 4) return y < 350 ? "short" : y < 420 ? "mid" : "long";
  return y < 480 ? "short" : y < 540 ? "mid" : "long";
}

export function siBand(strokeIndex: number | null): "1-6" | "7-12" | "13-18" | null {
  const si = num(strokeIndex);
  if (si == null || si < 1 || si > 18) return null;
  return si <= 6 ? "1-6" : si <= 12 ? "7-12" : "13-18";
}

function coverage(rows: ShotRow[], has: (r: ShotRow) => boolean): Coverage {
  const rounds = new Set<string>();
  let holes = 0;
  for (const r of rows) {
    if (!has(r)) continue;
    holes += 1;
    if (r.round_id) rounds.add(r.round_id);
  }
  return { holes, rounds: rounds.size };
}

/** True when the approach row was tapped at all (green or any miss axis). */
function hasApproach(r: ShotRow): boolean {
  return r.approach_green != null || r.approach_miss_v != null || r.approach_miss_h != null;
}

/** Which dispersion cell an approach landed in, or null when none was recorded. */
export function approachCellOf(r: ShotRow): ApproachCell | null {
  if (!hasApproach(r)) return null;
  if (r.approach_green === true) return "green";
  const v = r.approach_miss_v;
  const h = r.approach_miss_h;
  if (v === "long") return h === "left" ? "long_left" : h === "right" ? "long_right" : "long";
  if (v === "short") return h === "left" ? "short_left" : h === "right" ? "short_right" : "short";
  if (h === "left") return "left";
  if (h === "right") return "right";
  // Missed the green but no direction given — no cell to attribute it to.
  return null;
}

/** Count of shot-tracking fields explicitly recorded on this hole. */
export function recordedFieldCount(r: ShotRow): number {
  let n = 0;
  if (num(r.putts) != null) n += 1;
  if (r.fairway != null) n += 1;
  if (hasApproach(r)) n += 1;
  if (r.bunker != null) n += 1;
  if (num(r.penalties) != null) n += 1;
  return n;
}

/** See TRACKED_FIELD_MIN — a hole the player was demonstrably tracking. */
export function isTrackedHole(r: ShotRow): boolean {
  return recordedFieldCount(r) >= TRACKED_FIELD_MIN;
}

/** Penalty strokes, reading an untapped field on a tracked hole as zero. */
export function penaltiesOf(r: ShotRow): number | null {
  const explicit = num(r.penalties);
  if (explicit != null) return explicit;
  return isTrackedHole(r) ? 0 : null;
}

/**
 * Whether the hole involved a bunker, reading an untapped field on a tracked
 * hole as false. Note this can only ever *add* a false — a sand-save
 * opportunity (which needs true) can never be invented by inference.
 */
export function bunkerOf(r: ShotRow): boolean | null {
  if (r.bunker != null) return r.bunker;
  return isTrackedHole(r) ? false : null;
}

function buildBreakdown(label: string, rows: ShotRow[]): Breakdown {
  let girN = 0;
  let girHits = 0;
  let firN = 0;
  let firHits = 0;
  let scrambleN = 0;
  let scrambleHits = 0;
  const putts: number[] = [];

  for (const r of rows) {
    const par = num(r.par);
    const strokes = num(r.strokes);
    const p = num(r.putts);
    if (p != null) putts.push(p);

    const gir = girOf(r);
    if (gir != null) {
      girN += 1;
      if (gir) girHits += 1;
      if (!gir && par != null && strokes != null) {
        scrambleN += 1;
        if (strokes <= par) scrambleHits += 1;
      }
    }

    if (r.fairway != null && par != null && par >= 4) {
      firN += 1;
      if (r.fairway === "hit") firHits += 1;
    }
  }

  return {
    label,
    gir: rate(girHits, girN),
    fir: rate(firHits, firN),
    putts: avg(putts),
    scramble: rate(scrambleHits, scrambleN),
  };
}

export function computeShotTracking(rows: ShotRow[]): ShotTrackingStats {
  // Putting
  const puttRows = rows.filter((r) => num(r.putts) != null);
  const puttValues = puttRows.map((r) => num(r.putts) as number);
  const putting = avg(puttValues);

  let zero = 0;
  let one = 0;
  let two = 0;
  let threePlus = 0;
  for (const p of puttValues) {
    if (p === 0) zero += 1;
    else if (p === 1) one += 1;
    else if (p === 2) two += 1;
    else threePlus += 1;
  }

  const puttsOnGir: number[] = [];
  const puttsOffGir: number[] = [];

  // GIR + scrambling
  let girN = 0;
  let girHits = 0;
  const girByPar = new Map<number, { n: number; hits: number }>();

  let parSaveN = 0;
  let parSaveHits = 0;
  let bogeySaveN = 0;
  let bogeySaveHits = 0;
  let sandSaveN = 0;
  let sandSaveHits = 0;
  let bunkerHoles = 0;

  // Fairways
  let firN = 0;
  let firHits = 0;
  let missLeft = 0;
  let missRight = 0;
  const firByPar = new Map<number, { n: number; hits: number }>();

  // Approach dispersion
  let approachN = 0;
  let approachGreen = 0;
  let approachShort = 0;
  let approachLong = 0;
  let approachLeft = 0;
  let approachRight = 0;
  const approachGrid = Object.fromEntries(
    APPROACH_CELL_ORDER.map((c) => [c, 0])
  ) as Record<ApproachCell, number>;

  // Penalties + bunkers (inferred zeros on tracked holes — see TRACKED_FIELD_MIN)
  const penaltyValues: number[] = [];
  let penaltyTotal = 0;
  let holesWithPenalty = 0;
  let bunkerKnown = 0;

  for (const r of rows) {
    const par = num(r.par);
    const strokes = num(r.strokes);
    const p = num(r.putts);
    const gir = girOf(r);

    if (gir != null) {
      girN += 1;
      if (gir) girHits += 1;
      if (par != null) {
        const b = girByPar.get(par) ?? { n: 0, hits: 0 };
        b.n += 1;
        if (gir) b.hits += 1;
        girByPar.set(par, b);
      }
      if (p != null) (gir ? puttsOnGir : puttsOffGir).push(p);

      if (!gir && par != null && strokes != null) {
        parSaveN += 1;
        if (strokes <= par) parSaveHits += 1;
        bogeySaveN += 1;
        if (strokes <= par + 1) bogeySaveHits += 1;

        // Sand save needs both conditions: in a bunker AND the green missed.
        // Without the GIR condition a fairway bunker on a green-hit hole would
        // count as a save opportunity.
        if (r.bunker === true) {
          sandSaveN += 1;
          if (strokes <= par) sandSaveHits += 1;
        }
      }
    }

    const bunker = bunkerOf(r);
    if (bunker != null) {
      bunkerKnown += 1;
      if (bunker) bunkerHoles += 1;
    }

    if (r.fairway != null && par != null && par >= 4) {
      firN += 1;
      if (r.fairway === "hit") firHits += 1;
      else if (r.fairway === "left") missLeft += 1;
      else if (r.fairway === "right") missRight += 1;

      const b = firByPar.get(par) ?? { n: 0, hits: 0 };
      b.n += 1;
      if (r.fairway === "hit") b.hits += 1;
      firByPar.set(par, b);
    }

    if (hasApproach(r)) {
      approachN += 1;
      if (r.approach_green === true) approachGreen += 1;
      if (r.approach_miss_v === "short") approachShort += 1;
      if (r.approach_miss_v === "long") approachLong += 1;
      if (r.approach_miss_h === "left") approachLeft += 1;
      if (r.approach_miss_h === "right") approachRight += 1;

      const cell = approachCellOf(r);
      if (cell) approachGrid[cell] += 1;
    }

    const pen = penaltiesOf(r);
    if (pen != null) {
      penaltyValues.push(pen);
      penaltyTotal += pen;
      if (pen > 0) holesWithPenalty += 1;
    }
  }

  const sortedPars = (m: Map<number, { n: number; hits: number }>) =>
    [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([par, v]) => ({ label: `Par ${par}`, rate: rate(v.hits, v.n) }));

  // Breakdowns
  const byParRows = new Map<number, ShotRow[]>();
  const bySiRows = new Map<string, ShotRow[]>();
  const byLengthRows = new Map<string, ShotRow[]>();

  for (const r of rows) {
    const par = num(r.par);
    if (par != null) {
      const list = byParRows.get(par) ?? [];
      list.push(r);
      byParRows.set(par, list);
    }
    const si = siBand(r.stroke_index);
    if (si) {
      const list = bySiRows.get(si) ?? [];
      list.push(r);
      bySiRows.set(si, list);
    }
    const len = lengthBand(r.par, r.yardage);
    if (len) {
      const list = byLengthRows.get(len) ?? [];
      list.push(r);
      byLengthRows.set(len, list);
    }
  }

  const siOrder = ["1-6", "7-12", "13-18"];
  const lenOrder: Array<["short" | "mid" | "long", string]> = [
    ["short", "Short"],
    ["mid", "Mid"],
    ["long", "Long"],
  ];

  const penaltyAvg = avg(penaltyValues);

  return {
    // Explicit taps only — an inferred zero must never make an empty page look populated.
    anyData: rows.some((r) => recordedFieldCount(r) > 0),

    coverage: {
      putts: coverage(rows, (r) => num(r.putts) != null),
      fairway: coverage(rows, (r) => r.fairway != null),
      approach: coverage(rows, hasApproach),
      bunker: {
        ...coverage(rows, (r) => r.bunker != null),
        inferred: rows.filter((r) => r.bunker == null && isTrackedHole(r)).length,
      },
      penalties: {
        ...coverage(rows, (r) => num(r.penalties) != null),
        inferred: rows.filter((r) => num(r.penalties) == null && isTrackedHole(r)).length,
      },
      gir: coverage(rows, (r) => girOf(r) != null),
      tracked: coverage(rows, isTrackedHole),
    },

    putting: {
      overall: putting,
      per18: putting.avg == null ? null : putting.avg * 18,
      zero: rate(zero, puttValues.length),
      one: rate(one, puttValues.length),
      two: rate(two, puttValues.length),
      threePlus: rate(threePlus, puttValues.length),
      onGir: avg(puttsOnGir),
      offGir: avg(puttsOffGir),
    },

    gir: { overall: rate(girHits, girN), byPar: sortedPars(girByPar) },

    fir: {
      overall: rate(firHits, firN),
      missLeft: rate(missLeft, firN),
      missRight: rate(missRight, firN),
      byPar: sortedPars(firByPar),
    },

    approach: {
      n: approachN,
      green: rate(approachGreen, approachN),
      short: rate(approachShort, approachN),
      long: rate(approachLong, approachN),
      left: rate(approachLeft, approachN),
      right: rate(approachRight, approachN),
      grid: approachGrid,
    },

    scrambling: {
      parSave: rate(parSaveHits, parSaveN),
      bogeySave: rate(bogeySaveHits, bogeySaveN),
      sandSave: rate(sandSaveHits, sandSaveN),
      bunkerHoles: rate(bunkerHoles, bunkerKnown),
    },

    penalties: {
      overall: penaltyAvg,
      per18: penaltyAvg.avg == null ? null : penaltyAvg.avg * 18,
      total: penaltyTotal,
      holesWithPenalty: rate(holesWithPenalty, penaltyValues.length),
    },

    breakdowns: {
      byPar: [...byParRows.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([par, rs]) => buildBreakdown(`Par ${par}`, rs)),
      bySi: siOrder
        .filter((k) => bySiRows.has(k))
        .map((k) => buildBreakdown(`SI ${k}`, bySiRows.get(k)!)),
      byLength: lenOrder
        .filter(([k]) => byLengthRows.has(k))
        .map(([k, label]) => buildBreakdown(label, byLengthRows.get(k)!)),
    },
  };
}

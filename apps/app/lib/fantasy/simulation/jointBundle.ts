import { gzipSync, gunzipSync } from "zlib";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";
import type { JointMatrix } from "@/lib/fantasy/simulation/jointPricing";

/**
 * Serialization of the simulation's retained per-iteration joint samples
 * (fantasy_joint_samples row ⇄ typed arrays). Pure node (zlib only) so both
 * the odds service and vitest use the exact same encode/decode path.
 *
 * Every array is laid out flat as [playerIdx * simCount + iter], matching the
 * positions matrix. Int16 columns are little-endian — encode and decode both
 * run server-side on LE platforms (Node on x86/ARM), never in the browser.
 *
 * Rows written before 20260718000000 have NULL extra columns → the decoded
 * bundle simply lacks those arrays and bundleCapabilities reports what the
 * row can actually express; pricing falls back to positions-only behaviour.
 */

export type JointBundleRound = {
  gross: Int16Array;
  net: Int16Array;
  birdies: Int8Array;
};

/** A JointMatrix (positions) plus whatever extra samples the row retained. */
export type JointBundle = JointMatrix & {
  /** fantasy_joint_samples.event_version — pinned by acca cash-out offers. */
  eventVersion?: number;
  /** Event-wide birdie-or-better counts per iteration. */
  birdies?: Int8Array;
  /** Event-wide eagle-or-better counts per iteration. */
  eagles?: Int8Array;
  grossTotals?: Int16Array;
  netTotals?: Int16Array;
  /** Per-round totals, keyed by round number (multi-round events only). */
  rounds?: Record<number, JointBundleRound>;
};

/** What a loaded bundle can express — drives matrix-expressibility checks. */
export type JointCapabilities = {
  totals: boolean;
  birdies: boolean;
  eagles: boolean;
  rounds: Set<number>;
};

export function bundleCapabilities(bundle: JointBundle | null | undefined): JointCapabilities {
  if (!bundle) return { totals: false, birdies: false, eagles: false, rounds: new Set() };
  return {
    totals: bundle.grossTotals != null && bundle.netTotals != null,
    birdies: bundle.birdies != null,
    eagles: bundle.eagles != null,
    rounds: new Set(Object.keys(bundle.rounds ?? {}).map(Number)),
  };
}

export type RoundTotalsJson = Record<
  string,
  { gross_b64: string; net_b64: string; birdies_b64: string }
>;

/** Column values for one fantasy_joint_samples row (all gzip+base64). */
export type JointBundleColumns = {
  matrix_b64: string;
  birdies_b64: string;
  eagles_b64: string;
  gross_totals_b64: string;
  net_totals_b64: string;
  round_totals: RoundTotalsJson | null;
};

export type JointSampleRow = {
  player_ids: string[];
  sim_count: number;
  matrix_b64: string;
  birdies_b64?: string | null;
  eagles_b64?: string | null;
  gross_totals_b64?: string | null;
  net_totals_b64?: string | null;
  round_totals?: RoundTotalsJson | null;
  event_version?: number | null;
};

function gz(arr: Int8Array | Int16Array): string {
  return gzipSync(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).toString("base64");
}

function unzipInt8(b64: string): Int8Array {
  const bytes = gunzipSync(Buffer.from(b64, "base64"));
  return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function unzipInt16(b64: string): Int16Array {
  const bytes = gunzipSync(Buffer.from(b64, "base64"));
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

function flattenInt8(sources: Int8Array[], simCount: number): Int8Array {
  const flat = new Int8Array(sources.length * simCount);
  sources.forEach((src, pi) => flat.set(src, pi * simCount));
  return flat;
}

function flattenInt16(sources: Int16Array[], simCount: number): Int16Array {
  const flat = new Int16Array(sources.length * simCount);
  sources.forEach((src, pi) => flat.set(src, pi * simCount));
  return flat;
}

/**
 * Encode a finished simulation into fantasy_joint_samples column values.
 * Returns null when the sim retained no positions (nothing worth persisting).
 * round_totals is written only for multi-round events — a single round's
 * totals ARE the event totals.
 */
export function encodeBundleColumns(sim: SimulationResult): JointBundleColumns | null {
  if (!sim.positions) return null;
  const s = sim.simulationCount;
  const players = sim.players;
  const roundNumbers = Object.keys(players[0]?.roundGrossTotals ?? {}).map(Number);

  let roundTotals: RoundTotalsJson | null = null;
  if (roundNumbers.length > 1) {
    roundTotals = {};
    for (const r of roundNumbers) {
      roundTotals[String(r)] = {
        gross_b64: gz(flattenInt16(players.map((p) => p.roundGrossTotals[r]), s)),
        net_b64: gz(flattenInt16(players.map((p) => p.roundNetTotals[r]), s)),
        birdies_b64: gz(flattenInt8(players.map((p) => p.roundBirdieCounts[r]), s)),
      };
    }
  }

  return {
    matrix_b64: gz(sim.positions),
    birdies_b64: gz(flattenInt8(players.map((p) => p.birdieCounts), s)),
    eagles_b64: gz(flattenInt8(players.map((p) => p.eagleCounts), s)),
    gross_totals_b64: gz(flattenInt16(players.map((p) => p.grossTotals), s)),
    net_totals_b64: gz(flattenInt16(players.map((p) => p.netTotals), s)),
    round_totals: roundTotals,
  };
}

export function decodeBundleRow(row: JointSampleRow): JointBundle {
  const bundle: JointBundle = {
    playerIds: row.player_ids,
    simCount: row.sim_count,
    positions: unzipInt8(row.matrix_b64),
  };
  if (row.event_version != null) bundle.eventVersion = Number(row.event_version);
  if (row.birdies_b64) bundle.birdies = unzipInt8(row.birdies_b64);
  if (row.eagles_b64) bundle.eagles = unzipInt8(row.eagles_b64);
  if (row.gross_totals_b64) bundle.grossTotals = unzipInt16(row.gross_totals_b64);
  if (row.net_totals_b64) bundle.netTotals = unzipInt16(row.net_totals_b64);
  if (row.round_totals) {
    const rounds: Record<number, JointBundleRound> = {};
    for (const [key, cols] of Object.entries(row.round_totals)) {
      rounds[Number(key)] = {
        gross: unzipInt16(cols.gross_b64),
        net: unzipInt16(cols.net_b64),
        birdies: unzipInt8(cols.birdies_b64),
      };
    }
    bundle.rounds = rounds;
  }
  return bundle;
}

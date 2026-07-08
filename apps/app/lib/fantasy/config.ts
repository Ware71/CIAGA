import type { FantasyConfig } from "@/lib/fantasy/types";

/**
 * Validation for fantasy points quantities: whole points, sane upper bound.
 * Mirrors lib/validation/money.ts but points are integers.
 */
export const MAX_FANTASY_POINTS = 1_000_000;

export function parsePointsAmount(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > MAX_FANTASY_POINTS) return null;
  return n;
}

export type FantasyConfigInput = {
  mode: unknown;
  budgetScope: unknown;
  budgetAmount: unknown;
  topupIncrement?: unknown;
};

/**
 * Validate an admin-supplied fantasy config payload.
 * Returns the config to store, or an error message for a 400 response.
 */
export function parseFantasyConfigInput(
  body: FantasyConfigInput,
  updatedByProfileId: string
): { config: FantasyConfig } | { error: string } {
  if (body.mode !== "fixed" && body.mode !== "topup") {
    return { error: "mode must be 'fixed' or 'topup'" };
  }
  if (body.budgetScope !== "season" && body.budgetScope !== "event") {
    return { error: "budgetScope must be 'season' or 'event'" };
  }

  const budgetAmount = parsePointsAmount(body.budgetAmount);
  if (budgetAmount === null) {
    return { error: `budgetAmount must be a whole number between 1 and ${MAX_FANTASY_POINTS}` };
  }

  const config: FantasyConfig = {
    mode: body.mode,
    budgetScope: body.budgetScope,
    budgetAmount,
    enabledAt: new Date().toISOString(),
    updatedByProfileId,
  };

  if (body.mode === "topup") {
    const topupIncrement = parsePointsAmount(body.topupIncrement);
    if (topupIncrement === null) {
      return { error: `topupIncrement must be a whole number between 1 and ${MAX_FANTASY_POINTS}` };
    }
    config.topupIncrement = topupIncrement;
  }

  return { config };
}

/** Narrow a stored jsonb value to FantasyConfig (rows written before validation hardening excluded). */
export function readFantasyConfig(value: unknown): FantasyConfig | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.mode !== "fixed" && v.mode !== "topup") return null;
  if (v.budgetScope !== "season" && v.budgetScope !== "event") return null;
  if (typeof v.budgetAmount !== "number") return null;
  return v as FantasyConfig;
}

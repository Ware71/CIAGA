/**
 * User-facing terminology for combo bets. UK default: "Accumulator" / "Acca".
 * A future locale switch (US "Parlay") changes this one lookup — no string
 * hunt. Internal names (tables, types, RPCs) stay `parlay`.
 */
export const COMBO_BET = {
  long: "Accumulator",
  short: "Acca",
  plural: "Accas",
} as const;

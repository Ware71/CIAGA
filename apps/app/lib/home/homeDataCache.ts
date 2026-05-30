import type { HomeSummary } from "./getHomeSummary";

let cache: { data: HomeSummary; ts: number } | null = null;
const TTL = 120_000;

export const getCachedHomeData = (): HomeSummary | null => {
  if (!cache || Date.now() - cache.ts > TTL) return null;
  return cache.data;
};

export const setCachedHomeData = (data: HomeSummary): void => {
  cache = { data, ts: Date.now() };
};

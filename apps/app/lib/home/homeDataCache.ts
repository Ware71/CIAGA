import type { HomeSummary } from "./getHomeSummary";
import type { MajorHubSummary } from "@/lib/majors/types";

interface HomeCache {
  home: HomeSummary;
  majors: MajorHubSummary | null;
  ts: number;
}

let cache: HomeCache | null = null;
const TTL = 120_000;

export const getCachedHomeData = (): { home: HomeSummary; majors: MajorHubSummary | null } | null => {
  if (!cache || Date.now() - cache.ts > TTL) return null;
  return { home: cache.home, majors: cache.majors };
};

export const setCachedHomeData = (home: HomeSummary, majors: MajorHubSummary | null): void => {
  cache = { home, majors, ts: Date.now() };
};

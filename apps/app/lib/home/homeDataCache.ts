import type { HomeSummary } from "./getHomeSummary";

let cached: HomeSummary | null = null;

export const setHomeCache = (data: HomeSummary): void => {
  cached = data;
};

export const popHomeCache = (): HomeSummary | null => {
  const data = cached;
  cached = null;
  return data;
};

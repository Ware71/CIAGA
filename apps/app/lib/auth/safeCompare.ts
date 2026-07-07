import { timingSafeEqual, createHash } from "crypto";

/**
 * Constant-time string comparison for secrets (cron secret, admin API key).
 * Hashing first normalises the lengths, so timingSafeEqual never throws and
 * the comparison leaks neither content nor length.
 */
export function safeCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

import type { FeedCursor, FeedItemType, FeedPayloadByType } from "@/lib/feed/types";

/**
 * Cursor helpers
 * We encode `{ occurred_at, id }` as base64url(JSON).
 */

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  return base64UrlEncode(JSON.stringify(cursor));
}

export function decodeFeedCursor(cursorStr: string): FeedCursor | null {
  try {
    const raw = base64UrlDecode(cursorStr);
    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.occurred_at !== "string" ||
      typeof parsed.id !== "string"
    ) {
      return null;
    }

    return { occurred_at: parsed.occurred_at, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Tiny runtime validators (no zod dependency).
 * Keep these deliberately strict to avoid malformed payloads leaking into UI.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isStringArrayOrNull(v: unknown): v is string[] | null {
  return (
    v === null ||
    (Array.isArray(v) && v.every((x) => typeof x === "string"))
  );
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || typeof v === "number";
}

function isTaggedProfilesOrNull(
  v: unknown
): v is Array<{ profile_id: string; name: string }> | null {
  return (
    v === null ||
    (Array.isArray(v) &&
      v.every(
        (x) =>
          isRecord(x) &&
          typeof x.profile_id === "string" &&
          typeof x.name === "string"
      ))
  );
}

/**
 * Validate and normalize payload by type.
 * Return null if invalid.
 */
export function parseFeedPayload<TType extends FeedItemType>(
  type: TType,
  payload: unknown
): FeedPayloadByType[TType] | null {
  if (!isRecord(payload)) return null;

  switch (type) {
    case "user_post": {
      const text = "text" in payload ? (isStringOrNull(payload.text) ? payload.text : undefined) : undefined;
      const image_urls =
        "image_urls" in payload
          ? isStringArrayOrNull(payload.image_urls)
            ? payload.image_urls
            : undefined
          : undefined;

      const tagged_profiles =
        "tagged_profiles" in payload
          ? isTaggedProfilesOrNull(payload.tagged_profiles)
            ? payload.tagged_profiles
            : undefined
          : undefined;

      const tagged_round_id =
        "tagged_round_id" in payload && isStringOrNull(payload.tagged_round_id)
          ? payload.tagged_round_id
          : undefined;

      const tagged_course_id =
        "tagged_course_id" in payload && isStringOrNull(payload.tagged_course_id)
          ? payload.tagged_course_id
          : undefined;

      const tagged_course_name =
        "tagged_course_name" in payload && isStringOrNull(payload.tagged_course_name)
          ? payload.tagged_course_name
          : undefined;

      const created_from =
        "created_from" in payload && (payload.created_from === "web" || payload.created_from === "mobile" || payload.created_from === "system")
          ? payload.created_from
          : undefined;

      // Require at least text or at least one image URL (so empty posts aren't valid)
      const hasText = typeof text === "string" && text.trim().length > 0;
      const hasImage = Array.isArray(image_urls) && image_urls.length > 0;

      if (!hasText && !hasImage) return null;

      return {
        text: text ?? null,
        image_urls: image_urls ?? null,
        tagged_profiles: tagged_profiles ?? null,
        tagged_round_id: tagged_round_id ?? null,
        tagged_course_id: tagged_course_id ?? null,
        tagged_course_name: tagged_course_name ?? null,
        created_from: created_from ?? "web",
      } as FeedPayloadByType[TType];
    }

    // For now, we allow other types through if payload is an object.
    // Later, we’ll add strict validators per type as we implement each card.
    default:
      return payload as FeedPayloadByType[TType];
  }
}

/**
 * Safe helper: checks if a feed item type is supported by the UI right now.
 * Start small, grow safely.
 */
export function isSupportedFeedType(type: string): type is FeedItemType {
  return (
    type === "user_post" ||
    type === "round_played" ||
    type === "course_record" ||
    type === "pb" ||
    type === "leaderboard_move" ||
    type === "hole_event" ||
    type === "match_start" ||
    type === "match_update" ||
    type === "match_result" ||
    type === "hi_change" ||
    type === "trend" ||
    type === "system_announcement"
  );
}

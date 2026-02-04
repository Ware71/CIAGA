import type { FeedCursor, FeedItemType, FeedPayloadByType } from "@/lib/feed/types";

/**
 * Cursor helpers
 * We encode `{ occurred_at, id }` as base64url(JSON).
 *
 * IMPORTANT:
 * Normalize occurred_at to ISO Z (UTC) to avoid `+00:00` offsets in downstream
 * query strings / filters which can trigger 400s.
 */

function toIsoZ(input: string): string | null {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString(); // always ends with 'Z'
}

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
  const iso = toIsoZ(cursor.occurred_at) ?? cursor.occurred_at;
  return base64UrlEncode(JSON.stringify({ occurred_at: iso, id: cursor.id }));
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

    const iso = toIsoZ(parsed.occurred_at);
    if (!iso) return null;

    return { occurred_at: iso, id: parsed.id };
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
  return v === null || (Array.isArray(v) && v.every((x) => typeof x === "string"));
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || typeof v === "number";
}

function isIntegerOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isInteger(v));
}

function isPositiveNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

function isTaggedProfilesOrNull(v: unknown): v is Array<{ profile_id: string; name: string }> | null {
  return (
    v === null ||
    (Array.isArray(v) &&
      v.every((x) => isRecord(x) && typeof x.profile_id === "string" && typeof x.name === "string"))
  );
}

function isRoundPlayedPlayers(
  v: unknown
): v is Array<{
  profile_id?: string | null;
  name: string;
  avatar_url?: string | null;
  gross_total?: number | null;
  net_total?: number | null;
  par_total?: number | null;
  net_to_par?: number | null;
}> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (x) =>
        isRecord(x) &&
        (x.profile_id === undefined || isStringOrNull(x.profile_id)) &&
        typeof x.name === "string" &&
        (x.avatar_url === undefined || isStringOrNull(x.avatar_url)) &&
        (x.gross_total === undefined || isNumberOrNull(x.gross_total)) &&
        (x.net_total === undefined || isNumberOrNull(x.net_total)) &&
        (x.par_total === undefined || isNumberOrNull(x.par_total)) &&
        (x.net_to_par === undefined || isNumberOrNull(x.net_to_par))
    )
  );
}

function isHoleEventKind(v: unknown): v is "eagle" | "albatross" | "hio" {
  return v === "eagle" || v === "albatross" || v === "hio";
}

function isHoleEventLegacyEvent(v: unknown): v is "eagle" | "albatross" | "hole_in_one" {
  return v === "eagle" || v === "albatross" || v === "hole_in_one";
}

function isMetric(v: unknown): v is "gross" | "net" {
  return v === "gross" || v === "net";
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
      const text =
        "text" in payload ? (isStringOrNull(payload.text) ? payload.text : undefined) : undefined;

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
        "created_from" in payload &&
        (payload.created_from === "web" ||
          payload.created_from === "mobile" ||
          payload.created_from === "system")
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

    case "round_played": {
      const round_id = typeof payload.round_id === "string" ? payload.round_id : null;
      const course_name = typeof payload.course_name === "string" ? payload.course_name : null;

      const course_id =
        "course_id" in payload && isStringOrNull(payload.course_id) ? payload.course_id : null;

      const tee_name =
        "tee_name" in payload && isStringOrNull(payload.tee_name) ? payload.tee_name : null;

      const date = "date" in payload && isStringOrNull(payload.date) ? payload.date : null;

      const players =
        "players" in payload && isRoundPlayedPlayers(payload.players) ? payload.players : null;

      if (!round_id || !course_name || !players) return null;

      return {
        round_id,
        course_id,
        course_name,
        tee_name,
        players,
        date,
      } as FeedPayloadByType[TType];
    }

    case "hole_event": {
      /**
       * New shape (preferred):
       * { kind, hole_number, par, yardage?, round_id?, course_name?, ... }
       *
       * Legacy shape (allowed):
       * { event, hole_number, par, score|strokes, ... }
       */

      const kind = "kind" in payload && isHoleEventKind(payload.kind) ? payload.kind : undefined;
      const event =
        "event" in payload && isHoleEventLegacyEvent(payload.event) ? payload.event : undefined;

      const hole_number =
        "hole_number" in payload && isIntegerOrNull(payload.hole_number) ? payload.hole_number : null;

      const par = "par" in payload && isIntegerOrNull(payload.par) ? payload.par : null;

      const yardage =
        "yardage" in payload && isPositiveNumberOrNull(payload.yardage) ? payload.yardage : null;

      // Legacy-only numeric fields (allow but not required for new shape)
      const score =
        "score" in payload && typeof payload.score === "number" ? (payload.score as number) : undefined;
      const strokes =
        "strokes" in payload && typeof payload.strokes === "number" ? (payload.strokes as number) : undefined;

      // Optional context
      const round_id =
        "round_id" in payload && isStringOrNull(payload.round_id) ? payload.round_id : null;
      const course_id =
        "course_id" in payload && isStringOrNull(payload.course_id) ? payload.course_id : null;
      const course_name =
        "course_name" in payload && isStringOrNull(payload.course_name) ? payload.course_name : null;
      const tee_name =
        "tee_name" in payload && isStringOrNull(payload.tee_name) ? payload.tee_name : null;
      const date = "date" in payload && isStringOrNull(payload.date) ? payload.date : null;

      if (hole_number === null || par === null) return null;
      if (!kind && !event) return null;

      // If it’s legacy (event provided), require score/strokes (old cards relied on it)
      if (event && score === undefined && strokes === undefined) return null;

      // Normalize legacy event -> kind if kind missing
      const normalizedKind =
        kind ??
        (event === "hole_in_one" ? "hio" : event === "eagle" ? "eagle" : event === "albatross" ? "albatross" : undefined);

      if (!normalizedKind) return null;

      return {
        kind: normalizedKind,
        round_id,
        course_id,
        course_name,
        tee_name,
        hole_number,
        par,
        yardage,
        date,
        // keep legacy numeric fields if present (harmless)
        score,
        strokes,
      } as FeedPayloadByType[TType];
    }

    case "pb":
    case "course_record": {
      /**
       * New shapes (preferred):
       * pb:          { course_name, tee_name?, gross_total, round_id?, ... }
       * course_record:{ course_name, tee_name?, gross_total, round_id?, ... }
       *
       * Legacy shape (allowed):
       * { metric: "gross"|"net", score: number, course_name?, tee_name?, gross?, ... }
       */

      // Prefer new fields
      const course_name =
        "course_name" in payload && isStringOrNull(payload.course_name) ? payload.course_name : null;
      const tee_name =
        "tee_name" in payload && isStringOrNull(payload.tee_name) ? payload.tee_name : null;
      const course_id =
        "course_id" in payload && isStringOrNull(payload.course_id) ? payload.course_id : null;
      const round_id =
        "round_id" in payload && isStringOrNull(payload.round_id) ? payload.round_id : null;
      const date = "date" in payload && isStringOrNull(payload.date) ? payload.date : null;

      const gross_total =
        "gross_total" in payload && isNumberOrNull(payload.gross_total) ? payload.gross_total : undefined;

      const name = "name" in payload && isStringOrNull(payload.name) ? payload.name : undefined;
      const avatar_url =
        "avatar_url" in payload && isStringOrNull(payload.avatar_url) ? payload.avatar_url : undefined;
      const profile_id =
        "profile_id" in payload && isStringOrNull(payload.profile_id) ? payload.profile_id : undefined;

      // Legacy bits (still accepted)
      const metric = "metric" in payload && isMetric(payload.metric) ? payload.metric : null;
      const score = typeof payload.score === "number" ? payload.score : null;
      const gross_legacy = "gross" in payload && isNumberOrNull(payload.gross) ? payload.gross : undefined;

      // Validate minimums
      // - New format: course_name required (both), gross_total must be number or null? (we require number for usefulness)
      // - Legacy format: metric + score required
      const hasNew = typeof course_name === "string" && typeof gross_total === "number";
      const hasLegacy = !!metric && score !== null;

      if (!hasNew && !hasLegacy) return null;

      // course_record must always have course_name
      if (type === "course_record" && !course_name) return null;
      // pb should also have course_name in new world; legacy items may not, so allow only if legacy
      if (type === "pb" && !course_name && !hasLegacy) return null;

      // Normalization: expose gross_total even for legacy if possible
      const normalizedGrossTotal =
        (typeof gross_total === "number" ? gross_total : undefined) ??
        (typeof gross_legacy === "number" ? gross_legacy : undefined) ??
        (metric === "gross" && typeof score === "number" ? score : undefined);

      // Return in the new-ish shape (but keep legacy fields if present, harmless)
      return {
        ...(payload as any),
        course_id,
        course_name,
        tee_name,
        round_id,
        date,
        profile_id: profile_id ?? undefined,
        name: name ?? undefined,
        avatar_url: avatar_url ?? undefined,
        gross_total: normalizedGrossTotal ?? null,
        metric: metric ?? undefined,
        score: score ?? undefined,
      } as FeedPayloadByType[TType];
    }

    // For now, we allow other types through if payload is an object.
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

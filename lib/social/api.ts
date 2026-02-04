// lib/social/api.ts
import { supabase } from "@/lib/supabaseClient";

export type FeedFetchResponse = {
  items: any[];
  next_cursor: string | null;
};

async function authedFetch(input: RequestInfo, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  // Only set JSON content-type when sending a body
  if (init?.body) headers.set("Content-Type", "application/json");

  return fetch(input, { ...init, headers });
}

async function parseJsonOrText(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function throwReadableError(res: Response) {
  const payload = await parseJsonOrText(res);
  const msg =
    typeof payload === "string"
      ? payload
      : (payload as any)?.error
        ? String((payload as any).error)
        : JSON.stringify(payload);
  throw new Error(msg || `Request failed (${res.status})`);
}

/**
 * Hardened coercion helpers so we never end up with
 * limit=[object Object] in querystrings again.
 */
function coerceInt(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.floor(value));
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return Math.max(1, n);
  }
  return fallback;
}

function getLimitFromMaybeOptions(value: unknown, fallback: number) {
  // supports: 100, "100", { limit: 100 }, { limit: "100" }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const maybe = (value as any).limit;
    return coerceInt(maybe, fallback);
  }
  return coerceInt(value, fallback);
}

function getCursorString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  // If someone accidentally passes an object, don't serialize to [object Object]
  // (server expects a base64url cursor string; better to just omit than break)
  return null;
}

// CHANGED: shared comment/author types (kept permissive for back-compat)
export type CommentAuthor = {
  // preferred keys
  profile_id?: string;
  display_name?: string;
  avatar_url: string | null;

  // legacy keys
  id?: string;
  name?: string;
};

export type FeedComment = {
  id: string;
  profile_id: string;
  body: string;
  created_at: string;
  author: CommentAuthor;
  is_mine: boolean;

  like_count?: number;
  i_liked?: boolean;
};

export async function fetchFeed(params: { limit: number; cursor?: string | null }) {
  const qs = new URLSearchParams();

  // harden in case callers ever pass weird values
  qs.set("limit", String(getLimitFromMaybeOptions(params.limit, 20)));

  const cursorStr = getCursorString(params.cursor);
  if (cursorStr) qs.set("cursor", cursorStr);

  const res = await authedFetch(`/api/feed?${qs.toString()}`, { method: "GET" });
  if (!res.ok) await throwReadableError(res);
  return (await res.json()) as FeedFetchResponse;
}

export async function fetchLiveFeedItems() {
  const res = await authedFetch(`/api/feed/live`, { method: "GET" });
  if (!res.ok) await throwReadableError(res);
  return (await res.json()) as { items: any[] };
}

/** ReactionBar expects this */
export async function reactToFeedItem(feedItemId: string, emoji: string) {
  const res = await authedFetch(`/api/feed/${feedItemId}/react`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) await throwReadableError(res);

  // Server should be: { status: "set" | "removed", emoji: string | null }
  // We also tolerate legacy "cleared".
  return (await res.json()) as { status: "set" | "removed" | "cleared"; emoji: string | null };
}

/** CommentDrawer expects this */
export async function commentOnFeedItem(feedItemId: string, body: string) {
  const res = await authedFetch(`/api/feed/${feedItemId}/comment`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (!res.ok) await throwReadableError(res);
  return (await res.json()) as { ok: true } | any;
}

/**
 * CommentDrawer calls fetchComments(feedItemId, 100)
 * But we ALSO tolerate fetchComments(feedItemId, { limit: 100 })
 */
export async function fetchComments(
  feedItemId: string,
  limitOrOptions: number | { limit?: number | string } | string = 50
) {
  const limit = getLimitFromMaybeOptions(limitOrOptions, 50);

  const qs = new URLSearchParams();
  qs.set("limit", String(limit));

  const res = await authedFetch(`/api/feed/${feedItemId}/comments?${qs.toString()}`, {
    method: "GET",
  });
  if (!res.ok) await throwReadableError(res);

  // CHANGED: return typing matches server (author keys + like_count/i_liked)
  return (await res.json()) as {
    comments: FeedComment[];
  };
}

/**
 * PostComposer creates a post feed item.
 * API: POST /api/feed/post
 * Body: { audience: "followers" | "public", text: string, image_urls: string[] | null }
 */
export async function createPost(params: {
  audience: "followers" | "public";
  text: string;
  image_urls: string[] | null;
}) {
  const res = await authedFetch(`/api/feed/post`, {
    method: "POST",
    body: JSON.stringify({
      audience: params.audience,
      text: params.text,
      image_urls: params.image_urls,
    }),
  });

  if (!res.ok) await throwReadableError(res);
  return await res.json();
}

/**
 * (6) Comment likes: simple upvote/count.
 * API: POST /api/feed/comments/[comment_id]/like
 * Returns: { liked: boolean, count: number }
 */
export async function toggleCommentLike(commentId: string) {
  const res = await authedFetch(`/api/feed/comments/${commentId}/like`, {
    method: "POST",
  });
  if (!res.ok) await throwReadableError(res);
  return (await res.json()) as { liked: boolean; count: number };
}

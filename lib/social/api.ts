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
  headers.set("Content-Type", "application/json");

  return fetch(input, { ...init, headers });
}

export async function fetchFeed(params?: { cursor?: string | null; limit?: number }) {
  const q = new URLSearchParams();
  if (params?.cursor) q.set("cursor", params.cursor);
  if (params?.limit) q.set("limit", String(params.limit));

  const res = await authedFetch(`/api/feed?${q.toString()}`, { method: "GET" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as FeedFetchResponse;
}

export async function fetchLiveMatches() {
  const res = await authedFetch(`/api/feed/live`, { method: "GET" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { matches: any[] };
}

export async function createPost(input: {
  audience?: "followers" | "public" | "private" | "match_participants" | "custom_list";
  text?: string | null;
  image_urls?: string[] | null;
  tagged_profiles?: Array<{ profile_id: string; name: string }> | null;
  tagged_round_id?: string | null;
  tagged_course_id?: string | null;
  tagged_course_name?: string | null;
}) {
  const res = await authedFetch(`/api/feed/post`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { feed_item_id: string };
}

export async function reactToFeedItem(feedItemId: string, emoji: string) {
  const res = await authedFetch(`/api/feed/${feedItemId}/react`, {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { status: "set" | "removed"; emoji: string | null };
}

export async function commentOnFeedItem(feedItemId: string, body: string, parent_comment_id?: string | null) {
  const res = await authedFetch(`/api/feed/${feedItemId}/comment`, {
    method: "POST",
    body: JSON.stringify({ body, parent_comment_id: parent_comment_id ?? null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { comment_id: string };
}

export async function fetchComments(feedItemId: string, limit?: number) {
  const q = new URLSearchParams();
  if (limit) q.set("limit", String(limit));

  const res = await authedFetch(`/api/feed/${feedItemId}/comments?${q.toString()}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    comments: Array<{
      id: string;
      profile_id: string;
      body: string;
      created_at: string;
      author: { id: string; name: string; avatar_url: string | null };
      is_mine: boolean;
    }>;
  };
}

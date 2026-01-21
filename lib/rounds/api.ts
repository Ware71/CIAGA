import { supabase } from "@/lib/supabaseClient";

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

export async function finishRound(roundId: string) {
  const res = await authedFetch(`/api/rounds/${roundId}/finish`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { ok: true };
}

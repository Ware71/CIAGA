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

export type RoundResultInput = {
  winner_name?: string | null;
  winner_profile_id?: string | null;
  loser_name?: string | null;
  margin?: string | null;
  match_halved?: boolean;
};

export async function finishRound(roundId: string, result?: RoundResultInput) {
  const res = await authedFetch(`/api/rounds/${roundId}/finish`, {
    method: "POST",
    body: JSON.stringify(result ? { result } : {}),
  });

  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { ok: true };
}

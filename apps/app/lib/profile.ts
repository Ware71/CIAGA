import { supabase } from "@/lib/supabaseClient";

type User = {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; avatar_url?: string; name?: string };
};

export async function ensureProfile(_user: User) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;

  const token = sessionData.session?.access_token;
  if (!token) return;

  const res = await fetch("/api/profiles/ensure", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Failed to ensure profile");

  return json as { ok: boolean; profile_id: string; existed: boolean };
}

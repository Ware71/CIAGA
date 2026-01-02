import { supabase } from "@/lib/supabaseClient";

type User = {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string; avatar_url?: string };
};

export async function ensureProfile(user: User) {
  const name = user.user_metadata?.full_name || user.email || "Player";
  const avatar_url = user.user_metadata?.avatar_url || null;
  const email = (user.email || "").trim().toLowerCase();

  // 1) Find the profile owned by this auth user
  const { data: existing, error: findErr } = await supabase
    .from("profiles")
    .select("id, name, email, avatar_url")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (findErr) throw findErr;

  // 2) If it exists, fill blanks (don’t overwrite real user edits)
  if (existing) {
    const nextName = existing.name && existing.name.trim() ? existing.name : name;
    const nextEmail = existing.email ?? (email || null);
    const nextAvatar = existing.avatar_url ?? avatar_url;

    const { error: upErr } = await supabase
      .from("profiles")
      .update({
        name: nextName,
        email: nextEmail,
        avatar_url: nextAvatar,
      })
      .eq("id", existing.id);

    if (upErr) throw upErr;
    return;
  }

  // 3) Otherwise create a new owned profile (normal signup)
  const { error: insErr } = await supabase.from("profiles").insert({
    owner_user_id: user.id,
    name,
    email: email || null,
    avatar_url,
    is_admin: false,
  });

  if (insErr) throw insErr;
}

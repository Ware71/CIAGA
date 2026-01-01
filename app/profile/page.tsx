"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

type User = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
};

type ProfileRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

const AVATAR_BUCKET = "avatars";

export default function ProfilePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [followersCount, setFollowersCount] = useState<number>(0);
  const [followingCount, setFollowingCount] = useState<number>(0);

  // Modal state
  const [listOpen, setListOpen] = useState(false);
  const [listMode, setListMode] = useState<"followers" | "following">("followers");
  const [listLoading, setListLoading] = useState(false);
  const [listRows, setListRows] = useState<ProfileRow[]>([]);

  // Search users modal (only from Following view via +)
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);
  const [myFollowingSet, setMyFollowingSet] = useState<Set<string>>(new Set());
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = (data.user as any) ?? null;

      if (!alive) return;

      setUser(u);
      setLoading(false);

      if (!u) return;

      // Load profile row (fallbacks for name/avatar)
      const { data: p, error: pErr } = await supabase
        .from("profiles")
        .select("id, name, email, avatar_url")
        .eq("id", u.id)
        .single();

      if (!alive) return;

      if (pErr) console.warn("Profile load error:", pErr);
      else setProfile((p as any) ?? null);

      await refreshCountsAndFollowing(u.id);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const refreshCountsAndFollowing = async (uid: string) => {
    // Followers: people following me
    const followersRes = await supabase
      .from("follows")
      .select("id", { count: "exact", head: true })
      .eq("following_id", uid);

    // Following: people I follow
    const followingRes = await supabase
      .from("follows")
      .select("id", { count: "exact", head: true })
      .eq("follower_id", uid);

    setFollowersCount(followersRes.count ?? 0);
    setFollowingCount(followingRes.count ?? 0);

    // Keep a local set of who I follow (for the search modal buttons)
    const { data: fRows, error: fErr } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", uid);

    if (fErr) {
      console.warn("Failed loading my following set:", fErr);
      setMyFollowingSet(new Set());
    } else {
      setMyFollowingSet(new Set(((fRows as any) ?? []).map((r: any) => r.following_id)));
    }
  };

  const name =
    user?.user_metadata?.full_name ||
    profile?.name ||
    user?.email ||
    profile?.email ||
    "Player";

  const initials = (name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Prefer auth metadata avatar (current behaviour), fall back to profiles.avatar_url
  const avatarUrl = user?.user_metadata?.avatar_url || profile?.avatar_url || "";

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file || !user) return;
      if (!file.type.startsWith("image/")) return;

      setUploading(true);

      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      // Update auth metadata (existing behaviour)
      const { error: updateAuthError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });
      if (updateAuthError) throw updateAuthError;

      // Update profiles.avatar_url too (so it appears everywhere)
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);

      if (updateProfileError) console.warn("profiles.avatar_url update failed:", updateProfileError);
      else setProfile((prev) => (prev ? { ...prev, avatar_url: publicUrl } : prev));

      // Update local auth state
      setUser((prev) =>
        prev
          ? (({
              ...prev,
              user_metadata: { ...(prev.user_metadata || {}), avatar_url: publicUrl },
            } as any) as User)
          : prev
      );
    } catch (err) {
      console.error("Avatar upload failed:", err);
      alert("Avatar upload failed. Check bucket exists + RLS + public bucket setting.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const initialsFor = (p: ProfileRow) => {
    const label = p.name || p.email || "P";
    return label
      .split(" ")
      .map((n) => n?.[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  const openList = async (mode: "followers" | "following") => {
    if (!user) return;

    setListMode(mode);
    setListOpen(true);
    setListLoading(true);
    setListRows([]);

    try {
      if (mode === "followers") {
        // follower_id -> profiles
        const { data, error } = await supabase
          .from("follows")
          .select(
            `
            profiles:profiles!follows_follower_id_fkey ( id, name, email, avatar_url )
          `
          )
          .eq("following_id", user.id);

        if (error) throw error;

        const rows = ((data as any[]) ?? []).map((r) => r.profiles).filter(Boolean) as ProfileRow[];
        setListRows(rows);
      } else {
        // following_id -> profiles
        const { data, error } = await supabase
          .from("follows")
          .select(
            `
            profiles:profiles!follows_following_id_fkey ( id, name, email, avatar_url )
          `
          )
          .eq("follower_id", user.id);

        if (error) throw error;

        const rows = ((data as any[]) ?? []).map((r) => r.profiles).filter(Boolean) as ProfileRow[];
        setListRows(rows);
      }
    } catch (e) {
      console.warn("Failed to load follow list:", e);
      alert(
        "Could not load the list. If you see a relationship error, your FK join name may differ. Paste the console error."
      );
    } finally {
      setListLoading(false);
    }
  };

  const closeList = () => {
    setListOpen(false);
    setListRows([]);
  };

  const runSearch = async () => {
    if (!user) return;
    const q = search.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);

    try {
      // simple search: name ilike OR email ilike, exclude me
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, avatar_url")
        .neq("id", user.id)
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(25);

      if (error) throw error;

      setSearchResults((data as any) ?? []);
    } catch (e) {
      console.warn("Search failed:", e);
      alert("Search failed. Check profiles select policy.");
    } finally {
      setSearchLoading(false);
    }
  };

  const follow = async (targetId: string) => {
    if (!user) return;
    setBusyUserId(targetId);

    try {
      const { error } = await supabase.from("follows").insert({
        follower_id: user.id,
        following_id: targetId,
      });

      if (error) throw error;

      setMyFollowingSet((prev) => {
        const n = new Set(prev);
        n.add(targetId);
        return n;
      });

      // refresh counts + list if open
      await refreshCountsAndFollowing(user.id);
      if (listOpen && listMode === "following") await openList("following");
    } catch (e) {
      console.warn("Follow failed:", e);
      alert("Follow failed. Check follows table + RLS policies.");
    } finally {
      setBusyUserId(null);
    }
  };

  const unfollow = async (targetId: string) => {
    if (!user) return;
    setBusyUserId(targetId);

    try {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", user.id)
        .eq("following_id", targetId);

      if (error) throw error;

      setMyFollowingSet((prev) => {
        const n = new Set(prev);
        n.delete(targetId);
        return n;
      });

      await refreshCountsAndFollowing(user.id);
      if (listOpen && listMode === "following") await openList("following");
    } catch (e) {
      console.warn("Unfollow failed:", e);
      alert("Unfollow failed. Check follows table + RLS policies.");
    } finally {
      setBusyUserId(null);
    }
  };

  const followingTitle = useMemo(() => "Following", []);
  const followersTitle = useMemo(() => "Followers", []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>

            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                Account
              </div>
            </div>

            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            Loading…
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>

            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                Account
              </div>
            </div>

            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            You’re not signed in.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header — MATCHES COURSES */}
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              Account
            </div>
          </div>

          {/* spacer to keep title centered */}
          <div className="w-[60px]" />
        </header>

        {/* Content */}
        <div className="mt-4 flex flex-col items-center">
          <Avatar className="h-24 w-24 border border-emerald-200/70 shadow-lg">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>

          <div className="mt-4 text-base font-semibold text-[#f5e6b0] truncate max-w-[280px] text-center">
            {name}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
          />

          <Button
            onClick={onPickFile}
            disabled={uploading}
            className="mt-4 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
          >
            {uploading ? "Uploading…" : "Change profile picture"}
          </Button>

          {/* CLICKABLE COUNTERS */}
          <div className="mt-6 w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <div className="grid grid-cols-2 divide-x divide-emerald-900/70 text-center">
              <button
                type="button"
                className="px-2 hover:bg-emerald-900/30 rounded-xl py-2"
                onClick={() => openList("followers")}
              >
                <div className="text-lg font-semibold text-emerald-50">{followersCount}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  {followersTitle}
                </div>
              </button>

              <button
                type="button"
                className="px-2 hover:bg-emerald-900/30 rounded-xl py-2"
                onClick={() => openList("following")}
              >
                <div className="text-lg font-semibold text-emerald-50">{followingCount}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  {followingTitle}
                </div>
              </button>
            </div>
          </div>

          <div className="mt-6 w-full text-xs text-emerald-100/70 text-center">
            More profile stats coming soon.
          </div>
        </div>
      </div>

      {/* FOLLOWERS / FOLLOWING LIST MODAL */}
      {listOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 px-4 py-10">
          <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-900/70">
              <div>
                <div className="text-sm font-semibold text-[#f5e6b0]">
                  {listMode === "followers" ? "Followers" : "Following"}
                </div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  {listMode === "followers" ? "People following you" : "People you follow"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {listMode === "following" && (
                  <Button
                    size="sm"
                    className="h-8 px-2 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                    onClick={() => {
                      setSearch("");
                      setSearchResults([]);
                      setSearchOpen(true);
                    }}
                    title="Find users to follow"
                  >
                    +
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-emerald-100 hover:bg-emerald-900/30"
                  onClick={closeList}
                >
                  Close
                </Button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-auto">
              {listLoading ? (
                <div className="p-4 text-sm text-emerald-100/70">Loading…</div>
              ) : listRows.length === 0 ? (
                <div className="p-4 text-sm text-emerald-100/70">No users yet.</div>
              ) : (
                <div className="divide-y divide-emerald-900/70">
                  {listRows.map((p) => {
                    const nm = p.name || p.email || "Player";
                    const busy = busyUserId === p.id;
                    const following = myFollowingSet.has(p.id);

                    return (
                      <div key={p.id} className="flex items-center gap-3 p-4">
                        <Avatar className="h-10 w-10 border border-emerald-200/70">
                          <AvatarImage src={p.avatar_url || ""} />
                          <AvatarFallback>{initialsFor(p)}</AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-emerald-50 truncate">{nm}</div>
                          <div className="text-xs text-emerald-100/60 truncate">{p.email}</div>
                        </div>

                        {/* Only show follow controls in FOLLOWING view (optional) */}
                        {listMode === "following" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            className="border-emerald-200/40 text-emerald-50 hover:bg-emerald-900/40"
                            onClick={() => unfollow(p.id)}
                          >
                            {busy ? "…" : "Unfollow"}
                          </Button>
                        )}

                        {/* In followers view: display only */}
                        {listMode === "followers" && (
                          <div className="text-[11px] text-emerald-100/60">
                            {following ? "Following" : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* SEARCH MODAL (opened via +) */}
          {searchOpen && (
            <div className="fixed inset-0 z-[60] bg-black/70 px-4 py-10">
              <div className="mx-auto w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21] shadow-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-900/70">
                  <div>
                    <div className="text-sm font-semibold text-[#f5e6b0]">Find users</div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                      Search & follow
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-emerald-100 hover:bg-emerald-900/30"
                    onClick={() => setSearchOpen(false)}
                  >
                    Close
                  </Button>
                </div>

                <div className="p-3 border-b border-emerald-900/70">
                  <div className="flex gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="flex-1 rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-sm outline-none placeholder:text-emerald-200/40"
                    />
                    <Button
                      size="sm"
                      className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                      onClick={runSearch}
                      disabled={searchLoading}
                    >
                      {searchLoading ? "…" : "Search"}
                    </Button>
                  </div>
                </div>

                <div className="max-h-[60vh] overflow-auto">
                  {searchLoading ? (
                    <div className="p-4 text-sm text-emerald-100/70">Searching…</div>
                  ) : searchResults.length === 0 ? (
                    <div className="p-4 text-sm text-emerald-100/70">
                      Type a name/email and press Search.
                    </div>
                  ) : (
                    <div className="divide-y divide-emerald-900/70">
                      {searchResults.map((p) => {
                        const nm = p.name || p.email || "Player";
                        const following = myFollowingSet.has(p.id);
                        const busy = busyUserId === p.id;

                        return (
                          <div key={p.id} className="flex items-center gap-3 p-4">
                            <Avatar className="h-10 w-10 border border-emerald-200/70">
                              <AvatarImage src={p.avatar_url || ""} />
                              <AvatarFallback>{initialsFor(p)}</AvatarFallback>
                            </Avatar>

                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-emerald-50 truncate">{nm}</div>
                              <div className="text-xs text-emerald-100/60 truncate">{p.email}</div>
                            </div>

                            {following ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                className="border-emerald-200/40 text-emerald-50 hover:bg-emerald-900/40"
                                onClick={() => unfollow(p.id)}
                              >
                                {busy ? "…" : "Following"}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                disabled={busy}
                                className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                                onClick={() => follow(p.id)}
                              >
                                {busy ? "…" : "Follow"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

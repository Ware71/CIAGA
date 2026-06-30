"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getViewerSession } from "@/lib/auth/viewerSession";

type ProfileLite = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type Props = {
  /** Group context: scopes the profile search and is the default invite target. */
  groupId?: string;
  /** Custom invite action (e.g. event invites). When set, overrides the default
   *  group-membership POST. */
  onInvite?: (profileId: string) => Promise<void>;
  /** Sheet header label. */
  title?: string;
  excludedProfileIds: Set<string>;
  onInvited: (profile: { id: string; name: string | null }) => void;
  onClose?: () => void;
};

async function resolveFollowingProfiles(ids: string[]): Promise<ProfileLite[]> {
  if (!ids.length) return [];
  const byProfileId = await supabase.rpc("get_profiles_public", { ids });
  if (!byProfileId.error && (byProfileId.data?.length ?? 0) > 0) {
    return byProfileId.data as ProfileLite[];
  }
  const byOwner = await supabase.rpc("get_profiles_public_by_owner_ids", { owner_ids: ids });
  if (byOwner.error) throw byOwner.error;
  const map = new Map((byOwner.data ?? []).map((p: any) => [p.owner_user_id, p]));
  return ids.map((id) => map.get(id)).filter(Boolean) as ProfileLite[];
}

function Avatar({ name }: { name: string | null }) {
  const initials = name?.slice(0, 2).toUpperCase() ?? "??";
  return (
    <div className="h-8 w-8 rounded-full bg-emerald-900/60 flex items-center justify-center text-[11px] font-bold text-emerald-200 shrink-0">
      {initials}
    </div>
  );
}

function ProfileRow({
  profile,
  onInvite,
  inviting,
}: {
  profile: ProfileLite;
  onInvite: () => void;
  inviting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Avatar name={profile.name} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-emerald-50 truncate">{profile.name ?? "Unknown"}</div>
        {profile.email && (
          <div className="text-[11px] text-emerald-200/45 truncate">{profile.email}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onInvite}
        disabled={inviting}
        className="shrink-0 text-[11px] font-semibold text-emerald-300 border border-emerald-700/50 rounded-full px-3 py-1 hover:bg-emerald-900/40 disabled:opacity-50"
      >
        {inviting ? "…" : "Invite"}
      </button>
    </div>
  );
}

export function InvitePlayerSheet({ groupId, onInvite, title, excludedProfileIds, onInvited, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [following, setFollowing] = useState<ProfileLite[]>([]);
  const [loadingFollowing, setLoadingFollowing] = useState(true);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ProfileLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const session = await getViewerSession();
        if (!session) return;
        setMyProfileId(session.profileId);
        const { data } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", session.profileId);
        const ids = (data ?? []).map((r: any) => r.following_id).filter(Boolean) as string[];
        const profiles = await resolveFollowingProfiles(ids);
        setFollowing(profiles);
      } finally {
        setLoadingFollowing(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const session = await getViewerSession();
        if (!session) return;
        const res = await fetch(
          `/api/profiles/search?q=${encodeURIComponent(q)}${groupId ? `&exclude_group_id=${groupId}` : ""}`,
          { headers: { Authorization: `Bearer ${session.accessToken}` } }
        );
        if (res.ok) {
          const j = await res.json();
          setSearchResults(j.profiles ?? []);
        }
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, groupId]);

  const alreadyExcluded = useMemo(() => {
    const s = new Set([...excludedProfileIds, ...invited]);
    if (myProfileId) s.add(myProfileId);
    return s;
  }, [excludedProfileIds, invited, myProfileId]);

  const q = query.trim().toLowerCase();
  const filteredFollowing = useMemo(
    () =>
      following.filter((p) => {
        if (alreadyExcluded.has(p.id)) return false;
        if (!q) return true;
        return (
          (p.name ?? "").toLowerCase().includes(q) ||
          (p.email ?? "").toLowerCase().includes(q)
        );
      }),
    [following, alreadyExcluded, q]
  );

  const filteredSearch = useMemo(
    () => searchResults.filter((p) => !alreadyExcluded.has(p.id)),
    [searchResults, alreadyExcluded]
  );

  async function handleInvite(profile: ProfileLite) {
    setInviting(profile.id);
    try {
      if (onInvite) {
        await onInvite(profile.id);
      } else if (groupId) {
        const session = await getViewerSession();
        if (!session) return;
        await fetch(`/api/majors/groups/${groupId}/members`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ profile_id: profile.id }),
        });
      }
      setInvited((prev) => new Set([...prev, profile.id]));
      onInvited({ id: profile.id, name: profile.name });
    } finally {
      setInviting(null);
    }
  }

  const showFollowing = filteredFollowing.length > 0;
  const showSearch = q.length >= 2;
  const noResults = showSearch && !searching && filteredSearch.length === 0;

  return (
    <div className="space-y-3">
      {onClose && (
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-emerald-50">{title ?? "Invite Members"}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-emerald-200/55 hover:text-emerald-200"
          >
            Done
          </button>
        </div>
      )}

      <input
        type="text"
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
        className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
      />

      {/* Following list (shown when no search, or filtered) */}
      {!showSearch && (
        <>
          {loadingFollowing && (
            <div className="text-[11px] text-emerald-200/40 text-center py-2">Loading…</div>
          )}
          {!loadingFollowing && showFollowing && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/40 font-semibold mb-1.5">
                Following
              </div>
              <div className="rounded-xl border border-emerald-900/50 bg-[#042713] overflow-hidden divide-y divide-emerald-900/40">
                {filteredFollowing.map((p) => (
                  <ProfileRow
                    key={p.id}
                    profile={p}
                    onInvite={() => handleInvite(p)}
                    inviting={inviting === p.id}
                  />
                ))}
              </div>
            </div>
          )}
          {!loadingFollowing && !showFollowing && (
            <div className="text-[11px] text-emerald-200/40 text-center py-2">
              Search for players to invite
            </div>
          )}
        </>
      )}

      {/* Search results */}
      {showSearch && (
        <>
          {searching && (
            <div className="text-[11px] text-emerald-200/40 text-center py-2">Searching…</div>
          )}
          {!searching && filteredSearch.length > 0 && (
            <div className="rounded-xl border border-emerald-900/50 bg-[#042713] overflow-hidden divide-y divide-emerald-900/40">
              {filteredSearch.map((p) => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  onInvite={() => handleInvite(p)}
                  inviting={inviting === p.id}
                />
              ))}
            </div>
          )}
          {noResults && (
            <div className="text-[11px] text-emerald-200/40 text-center py-2">No players found</div>
          )}
        </>
      )}

      {/* Invited confirmation */}
      {invited.size > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/45">Invited</div>
          {[...following, ...searchResults]
            .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
            .filter((p) => invited.has(p.id))
            .map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-emerald-700/30 bg-emerald-900/20 px-3 py-2"
              >
                <Avatar name={p.name} />
                <span className="flex-1 text-sm text-emerald-200/80 truncate">
                  {p.name ?? "Unknown"}
                </span>
                <span className="text-[10px] text-emerald-400/70">Invited ✓</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

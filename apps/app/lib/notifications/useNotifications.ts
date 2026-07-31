"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { readCache, writeCache, setCacheScope } from "@/lib/cache/clientCache";
import type { UserNotification } from "@/lib/notifications/render";

const SELECT = "id, profile_id, type, payload, read, group_key, created_at, updated_at";

const CACHE_KEY = "notifications";
// The realtime subscription below is the real freshness mechanism, so the
// snapshot only has to carry the badge across a cold start.
const CACHE_OPTS = { ttl: 7 * 24 * 60 * 60_000, staleTime: 0 };

/** Effective sort timestamp — grouped rows bump updated_at when merged. */
function ts(n: UserNotification): number {
  const t = n.updated_at ?? n.created_at;
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function sortDesc(rows: UserNotification[]): UserNotification[] {
  return [...rows].sort((a, b) => ts(b) - ts(a));
}

/**
 * Loads the current user's notifications and keeps them live via a Supabase
 * realtime subscription (INSERT/UPDATE/DELETE filtered to this profile).
 */
export function useNotifications(profileId: string | null, limit = 50) {
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(false);

  /** Keep the snapshot in step so the bell badge is right on the next cold start. */
  const persist = useCallback((rows: UserNotification[]) => {
    writeCache(CACHE_KEY, rows, CACHE_OPTS);
    return rows;
  }, []);

  const load = useCallback(async () => {
    if (!profileId) {
      setItems([]);
      return;
    }
    setCacheScope(profileId);

    // Paint the last known notifications first: the badge showed 0 and then
    // jumped to its real count once the query came back.
    const cached = readCache<UserNotification[]>(CACHE_KEY, CACHE_OPTS);
    if (cached) setItems(cached.data);
    else setLoading(true);

    const { data } = await supabase
      .from("user_notifications")
      .select(SELECT)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(limit);
    setItems(persist(sortDesc((data as UserNotification[]) ?? [])));
    setLoading(false);
  }, [profileId, limit, persist]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!profileId) return;
    const channel = supabase
      .channel(`user_notifications:${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_notifications",
          filter: `profile_id=eq.${profileId}`,
        },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as any)?.id;
              return persist(prev.filter((p) => p.id !== oldId));
            }
            const row = payload.new as UserNotification;
            if (!row?.id) return prev;
            const without = prev.filter((p) => p.id !== row.id);
            return persist(sortDesc([row, ...without]));
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, persist]);

  // Unread in the loaded page. Correct below `limit`, but it silently caps
  // there — hence the server-side count below.
  const loadedUnread = items.reduce((n, i) => n + (i.read ? 0 : 1), 0);

  // True unread, counted server-side. The loaded page is capped at `limit`
  // (50), so a user with more than that unread used to see a badge stuck at 50
  // while the app-icon badge — which notify.ts computes with count: exact —
  // showed the real figure. The two disagreed.
  const [serverUnread, setServerUnread] = useState<number | null>(null);

  const refreshUnread = useCallback(async () => {
    if (!profileId) {
      setServerUnread(null);
      return;
    }
    const { count, error } = await supabase
      .from("user_notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("read", false);
    if (!error) setServerUnread(count ?? 0);
  }, [profileId]);

  // Recount whenever the loaded set changes — covers the initial load, realtime
  // arrivals, and both mark-read paths without a second subscription.
  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread, items]);

  // Server figure once we have one; the loaded page until then. Mark-read
  // adjusts it optimistically below so the badge drops immediately rather than
  // waiting for the recount.
  const unreadCount = serverUnread ?? loadedUnread;

  const markRead = useCallback(async (id: string) => {
    let wasUnread = false;
    setItems((prev) => {
      wasUnread = prev.some((p) => p.id === id && !p.read);
      return persist(prev.map((p) => (p.id === id ? { ...p, read: true } : p)));
    });
    // Drop the badge now; the effect above reconciles against the server after.
    if (wasUnread) setServerUnread((n) => (n == null ? n : Math.max(0, n - 1)));
    await supabase.from("user_notifications").update({ read: true }).eq("id", id);
  }, [persist]);

  const markAllRead = useCallback(async () => {
    if (!profileId) return;
    setItems((prev) => persist(prev.map((p) => ({ ...p, read: true }))));
    setServerUnread(0);
    await supabase
      .from("user_notifications")
      .update({ read: true })
      .eq("profile_id", profileId)
      .eq("read", false);
  }, [profileId, persist]);

  return { items, loading, unreadCount, reload: load, markRead, markAllRead };
}

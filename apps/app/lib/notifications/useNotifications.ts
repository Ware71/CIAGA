"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { UserNotification } from "@/lib/notifications/render";

const SELECT = "id, profile_id, type, payload, read, group_key, created_at, updated_at";

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

  const load = useCallback(async () => {
    if (!profileId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("user_notifications")
      .select(SELECT)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(limit);
    setItems(sortDesc((data as UserNotification[]) ?? []));
    setLoading(false);
  }, [profileId, limit]);

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
              return prev.filter((p) => p.id !== oldId);
            }
            const row = payload.new as UserNotification;
            if (!row?.id) return prev;
            const without = prev.filter((p) => p.id !== row.id);
            return sortDesc([row, ...without]);
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId]);

  const unreadCount = items.reduce((n, i) => n + (i.read ? 0 : 1), 0);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, read: true } : p)));
    await supabase.from("user_notifications").update({ read: true }).eq("id", id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!profileId) return;
    setItems((prev) => prev.map((p) => ({ ...p, read: true })));
    await supabase
      .from("user_notifications")
      .update({ read: true })
      .eq("profile_id", profileId)
      .eq("read", false);
  }, [profileId]);

  return { items, loading, unreadCount, reload: load, markRead, markAllRead };
}

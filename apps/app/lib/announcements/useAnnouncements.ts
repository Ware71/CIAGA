"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Announcement = {
  id: string;
  slug: string | null;
  kind: "onboarding" | "promo" | "info" | string;
  title: string;
  body: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  priority: number;
  created_at: string;
};

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Loads active, unseen announcements for the current user and exposes
 * `markSeen` (persists to announcement_views so it never shows again).
 */
export function useAnnouncements(profileId: string | null) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!profileId) return;
    const t = await token();
    if (!t) return;
    try {
      const res = await fetch("/api/announcements/active", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const json = await res.json();
        setItems(json.announcements ?? []);
      }
    } finally {
      setLoaded(true);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const markSeen = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((a) => a.id !== id));
    const t = await token();
    if (!t) return;
    await fetch("/api/announcements/seen", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ announcement_id: id }),
    }).catch(() => {});
  }, []);

  return { items, loaded, markSeen, reload: load };
}

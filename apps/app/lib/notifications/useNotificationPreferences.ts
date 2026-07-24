"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { NotificationCategoryKey } from "@/lib/notifications/preferences";

/**
 * Loads and mutates the current user's muted notification categories.
 * An absent row means nothing is muted, so a fresh user needs no seeding —
 * the first toggle upserts the row.
 *
 * Muting suppresses push delivery only; the bell still receives everything.
 */
export function useNotificationPreferences(profileId: string | null) {
  const [muted, setMuted] = useState<Set<NotificationCategoryKey>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!profileId) {
      setMuted(new Set());
      return;
    }
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("muted_categories")
        .eq("profile_id", profileId)
        .maybeSingle();
      if (cancelled) return;
      const list = ((data as any)?.muted_categories ?? []) as NotificationCategoryKey[];
      setMuted(new Set(list));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const toggle = useCallback(
    async (key: NotificationCategoryKey) => {
      if (!profileId) return;

      // Optimistic — compute the next set outside setState so we can persist it.
      const next = new Set(muted);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setMuted(next);

      setSaving(true);
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          profile_id: profileId,
          muted_categories: Array.from(next),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id" }
      );
      setSaving(false);

      // Roll back on failure so the switch reflects what's actually stored.
      if (error) {
        console.error("[notifications] failed to save preferences:", error.message);
        setMuted(muted);
      }
    },
    [profileId, muted]
  );

  return { muted, loading, saving, toggle };
}

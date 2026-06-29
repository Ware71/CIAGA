"use client";

import { useEffect } from "react";
import { syncAppBadge } from "@/lib/push/clientPush";

/**
 * Keeps the installed PWA's app-icon badge in sync with a live count (typically
 * `useNotifications().unreadCount`) while the app is open. The service worker
 * handles the badge while the app is closed (on push); this covers the
 * foreground case and clears the badge to 0 once everything is read.
 */
export function useAppBadge(count: number): void {
  useEffect(() => {
    syncAppBadge(count);
  }, [count]);
}

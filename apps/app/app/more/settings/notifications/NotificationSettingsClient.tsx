"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/chrome";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";
import { getViewerSession } from "@/lib/auth/viewerSession";

/**
 * The same panel the bell's cog opens, on a page of its own.
 *
 * The profile id is resolved here rather than passed down, because the settings
 * route is a server component and the session lives on the client. Until it
 * lands the category switches render disabled, which is the honest state — the
 * push toggle is device-local and works either way.
 */
export default function NotificationSettingsClient() {
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getViewerSession().then((s) => {
      if (!cancelled) setProfileId(s?.profileId ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen px-4 pb-4">
      <div className="mx-auto w-full max-w-sm">
        <PageHeader
          title="Notifications"
          parent="Settings"
          parentHref="/more/settings"
        />
        <NotificationSettings profileId={profileId} />
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { setHomeCache } from "@/lib/home/homeDataCache";
import type { HomeSummary } from "@/lib/home/getHomeSummary";

export default function SplashPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const redirectTarget = useRef<string>("/home");

  // On mount: skip splash if already shown (back-navigation), else run auth + prefetch
  useEffect(() => {
    if (sessionStorage.getItem("splash_shown") === "1") {
      router.replace("/home");
      return;
    }

    let cancelled = false;
    let onlineCleanup: (() => void) | null = null;

    const minDelay = new Promise<void>((r) => setTimeout(r, 2200));
    const sessionPromise = getViewerSession();

    // Prefetch home summary concurrently with animation
    const summaryPromise: Promise<HomeSummary | null> = sessionPromise.then(
      async (session) => {
        if (!session || cancelled) return null;
        try {
          const res = await fetch("/api/home/summary", {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          });
          if (!res.ok) return null;
          return (await res.json()) as HomeSummary;
        } catch {
          return null;
        }
      }
    );

    Promise.all([minDelay, sessionPromise]).then(([, session]) => {
      if (cancelled) return;

      if (!session) {
        redirectTarget.current = "/auth";
        setAuthReady(true);
        return;
      }

      // Store prefetched data so /home can render instantly
      summaryPromise.then((summary) => {
        if (!cancelled && summary) setHomeCache(summary);
      });

      if (navigator.onLine) {
        setAuthReady(true);
      } else {
        const handler = () => {
          if (!cancelled) setAuthReady(true);
        };
        window.addEventListener("online", handler, { once: true });
        onlineCleanup = () => window.removeEventListener("online", handler);
      }
    });

    return () => {
      cancelled = true;
      onlineCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <LoadingScreen
      isReady={authReady}
      onDone={() => router.replace(redirectTarget.current)}
    />
  );
}

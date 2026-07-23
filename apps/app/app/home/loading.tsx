"use client";

import { SplashGrow } from "@/components/ui/SplashGrow";

/**
 * Suspense fallback shown while /home's server component resolves the session.
 *
 * On the FIRST visit this session it shows the grow splash (which HomeClient's
 * LoadingScreen then continues into pulse/spin/exit). On REPEAT visits — after
 * the splash has been seen — it shows a plain backdrop instead, so returning
 * users don't get the grow again. This mirrors the `splash_shown` gate
 * HomeClient uses for its own LoadingScreen; without it, making /home a server
 * component would reintroduce the grow on every navigation.
 *
 * On in-app navigations this fallback renders client-side, so sessionStorage is
 * available during render. `suppressHydrationWarning` covers the one edge where
 * it isn't — a hard reload by a returning user briefly shows the grow, which is
 * acceptable and only on a full reload, not in-app nav.
 */
export default function HomeLoading() {
  const seen =
    typeof window !== "undefined" &&
    window.sessionStorage.getItem("splash_shown") === "1";

  if (seen) {
    return (
      <div
        aria-hidden
        suppressHydrationWarning
        className="fixed inset-0 z-[10000] bg-[#042713]"
      />
    );
  }

  return <SplashGrow />;
}

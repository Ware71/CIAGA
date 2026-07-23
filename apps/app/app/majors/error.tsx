"use client";

import { ErrorScreen } from "@/components/ui/error-screen";

export default function MajorsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      title="Couldn't load Majors"
      message="The group, event or leaderboard behind this page failed to load. Your entries and picks are unaffected."
      digest={error.digest}
      onRetry={reset}
      homeHref="/majors"
    />
  );
}

"use client";

import { ErrorScreen } from "@/components/ui/error-screen";

export default function RoundError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      title="Couldn't load the round"
      message="Any scores you've already entered are saved — they sync from this device even if this screen won't load."
      digest={error.digest}
      onRetry={reset}
      homeHref="/round"
    />
  );
}

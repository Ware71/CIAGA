"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

type Props = {
  title?: string;
  message?: string;
  /** Digest from an error boundary — the only handle support has on a prod stack trace. */
  digest?: string;
  /** Error-boundary reset. Omitted on not-found, which has nothing to retry. */
  onRetry?: () => void;
  /** Where "Go home" points. Defaults to the home screen. */
  homeHref?: string;
};

/**
 * Shared failure screen for error boundaries and not-found, styled to the app
 * shell. Without this, a render throw drops the user onto Next's default
 * unstyled white page — jarring in an installed dark-themed PWA, and with no
 * way back.
 */
export function ErrorScreen({
  title = "Something went wrong",
  message = "That didn't load. It's usually a blip — try again.",
  digest,
  onRetry,
  homeHref = "/home",
}: Props) {
  return (
    <div className="min-h-[100dvh] bg-[color:var(--ciaga-ground)] text-slate-100 grid place-items-center px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="text-lg font-semibold tracking-wide text-[color:var(--sec-accent)]">{title}</div>
        <p className="text-sm font-medium text-[color:var(--sec-muted)]">{message}</p>

        <div className="flex items-center justify-center gap-2 pt-2">
          {onRetry ? (
            <Button
              variant="secondary"
              className="bg-[color:var(--sec-surface)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
              onClick={onRetry}
            >
              Try again
            </Button>
          ) : null}

          <Button
            asChild
            variant="ghost"
            className="text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
          >
            <Link href={homeHref}>Go home</Link>
          </Button>
        </div>

        {digest ? (
          <div className="pt-2 text-[10px] font-mono uppercase tracking-[0.16em] text-[color:var(--sec-muted)]">
            {digest}
          </div>
        ) : null}
      </div>
    </div>
  );
}

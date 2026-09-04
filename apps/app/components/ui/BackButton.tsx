"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type BaseProps = {
  disabled?: boolean;
  className?: string;
  /** Overrides the default "← Back" — e.g. "← Majors" when the target is known. */
  label?: string;
};

const DEFAULT_LABEL = "← Back";

type BackButtonProps = BaseProps &
  (
    | {
        /** Destination to go back to. Renders a real link, so Next prefetches it. */
        href: string;
        onClick?: never;
      }
    | {
        /** Imperative back — for stepping back within a page, or router.back(). */
        onClick: () => void;
        href?: never;
      }
  );

const BASE_CLASS =
  "px-2 text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)] shrink-0 min-w-[64px] justify-center";

// Narrow on `props` directly — destructuring with a rest element collapses the
// discriminated union and loses the href/onClick correlation.
export function BackButton(props: BackButtonProps) {
  const { disabled, className, label } = props;

  // Prefer `href`: it prefetches, supports middle-click / open-in-new-tab, and
  // is announced as a link. `onClick` stays for step-back within a page.
  if (props.href !== undefined) {
    return (
      <Button
        asChild
        variant="ghost"
        size="sm"
        className={cn(BASE_CLASS, disabled && "pointer-events-none opacity-50", className)}
      >
        <Link href={props.href}>{label ?? DEFAULT_LABEL}</Link>
      </Button>
    );
  }

  return (
    <ImperativeBackButton
      onClick={props.onClick}
      disabled={disabled}
      className={className}
      label={label}
    />
  );
}

function ImperativeBackButton({
  onClick,
  disabled,
  className,
  label,
}: { onClick: () => void } & BaseProps) {
  const [navigating, setNavigating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(BASE_CLASS, className)}
      disabled={disabled || navigating}
      onClick={() => {
        setNavigating(true);
        // Release the latch if nothing actually navigated — router.back() with no
        // history to pop is a no-op, and the button used to stay stuck on "…" for
        // the rest of the page's life.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setNavigating(false), 3000);
        onClick();
      }}
    >
      {navigating ? "…" : label ?? DEFAULT_LABEL}
    </Button>
  );
}

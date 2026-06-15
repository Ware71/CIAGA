// components/ui/InfoHint.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

type InfoHintProps = {
  /** Hint content shown in the popover. */
  children: React.ReactNode;
  /** Accessible label for the trigger. */
  label?: string;
  /** Icon size in px. */
  size?: number;
  className?: string;
  /** Horizontal alignment of the popover relative to the icon. */
  align?: "left" | "right";
};

/**
 * A small (i) icon that toggles a popover with explanatory text on tap/click.
 * Tap-friendly (no hover dependency) and closes on outside click or Escape.
 */
export function InfoHint({
  children,
  label = "More info",
  size = 14,
  className = "",
  align = "right",
}: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center justify-center rounded-full text-emerald-100/50 hover:text-emerald-100/90 transition-colors"
      >
        <Info style={{ width: size, height: size }} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-full z-30 mt-1.5 w-56 rounded-lg border border-emerald-900/70 bg-[#042713] p-3 text-[11px] font-normal leading-snug text-emerald-100/90 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}

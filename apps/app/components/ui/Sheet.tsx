"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, X } from "lucide-react";

/**
 * The bottom sheet.
 *
 * The app had nine hand-rolled versions of this — NotificationCenter,
 * RoundMenuSheet, ConfirmSheet, ScoreEntrySheet, PlayerStatsSheet,
 * RoundInfoSheet, TeamBuilderSheet, InvitePlayerSheet, CommentDrawer — sharing a
 * visual grammar and nothing else. This is that grammar, extracted from the
 * NotificationCenter one, which was the most complete.
 *
 * Portalled to <body> for two reasons that have both bitten this codebase:
 * a sheet rendered in place inherits its ancestors' drag and click handlers (the
 * notification bell used to navigate to Majors when you scrolled its list), and
 * a sheet rendered inside a feed card is clipped by that card's bounds — which
 * is why the reaction picker was cut off at the edge of the screen.
 */
export function Sheet({
  open,
  onClose,
  title,
  onBack,
  children,
  footer,
  /** Caps the panel height. Lists want the default; short menus can shrink. */
  maxHeight = "82vh",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** When given, a back chevron appears left of the title. */
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape to close, and hold the page still behind the sheet so a flick at the
  // end of the list doesn't scroll the feed underneath it.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  // Move focus into the panel so the sheet is where the keyboard is, and so
  // screen readers announce it rather than leaving the user back in the feed.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60" />

          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            className="relative flex w-full flex-col rounded-t-3xl border-t border-[color:var(--hair-panel)] bg-[color:var(--ciaga-ground)] px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 outline-none"
            style={{ maxHeight }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-[color:var(--sec-surface-2)]" />

            {title ? (
              <div className="mb-3 flex shrink-0 items-center gap-2">
                {onBack ? (
                  <button
                    type="button"
                    onClick={onBack}
                    className="-ml-1 shrink-0 rounded-full p-1 text-[color:var(--sec-muted)] transition hover:bg-[color:var(--sec-surface-2)] hover:text-[color:var(--sec-text)]"
                    aria-label="Back"
                  >
                    <ChevronLeft size={18} />
                  </button>
                ) : null}

                <div className="min-w-0 flex-1 truncate text-[length:var(--t-fig)] font-semibold text-[color:var(--sec-text)]">
                  {title}
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[color:var(--sec-muted)] transition hover:bg-[color:var(--sec-surface-2)] hover:text-[color:var(--sec-text)]"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>

            {footer ? <div className="shrink-0 pt-3">{footer}</div> : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * One tappable line in an action sheet. `tone="bad"` for destructive choices.
 */
export function SheetAction({
  icon,
  label,
  description,
  onClick,
  tone = "default",
  disabled,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  tone?: "default" | "bad";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-3 rounded-[var(--r-ui)] px-2 py-2.5 text-left transition",
        "hover:bg-[color:var(--sec-surface-2)] disabled:opacity-50",
        tone === "bad" ? "text-[color:var(--sec-bad)]" : "text-[color:var(--sec-text)]",
      ].join(" ")}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="min-w-0">
        <span className="block truncate text-[length:var(--t-body)] font-medium">{label}</span>
        {description ? (
          <span className="block truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

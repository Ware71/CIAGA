"use client";

import { useEffect, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/button";
import {
  REPORT_REASONS,
  reportContent,
  type ReportReasonCode,
  type ReportTargetType,
} from "@/lib/social/report";

/**
 * Report a post or a comment.
 *
 * Two steps rather than one form: pick a category, then optionally say more.
 * Requiring the free text first would mean asking someone to write out the
 * thing they're reporting before we'd take it, which is a poor ask when the
 * content is abusive.
 *
 * The confirmation at the end isn't decoration — the Online Safety Act expects
 * a reporter to be told their report was received.
 */
export default function ReportSheet({
  open,
  onClose,
  targetType,
  targetId,
}: {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
}) {
  const [reason, setReason] = useState<ReportReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    // Reset only after the exit animation, so the sheet doesn't visibly empty
    // itself on the way out.
    const t = setTimeout(() => {
      setReason(null);
      setNote("");
      setSent(false);
      setError(null);
    }, 300);
    return () => clearTimeout(t);
  }, [open]);

  async function submit() {
    if (!reason) return;
    setSending(true);
    setError(null);
    try {
      await reportContent({ targetType, targetId, reasonCode: reason, note });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that report.");
    } finally {
      setSending(false);
    }
  }

  const noun = targetType === "comment" ? "comment" : "post";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={sent ? "Report sent" : `Report this ${noun}`}
      onBack={reason && !sent ? () => setReason(null) : undefined}
      footer={
        sent ? (
          <Button
            className="w-full bg-[color:var(--sec-surface)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
            onClick={onClose}
          >
            Done
          </Button>
        ) : reason ? (
          <Button
            className="w-full bg-[color:var(--sec-accent)] font-medium text-[color:var(--ciaga-ground)] hover:bg-[color:color-mix(in_srgb,var(--sec-accent)_90%,transparent)]"
            onClick={submit}
            pending={sending}
          >
            Send report
          </Button>
        ) : undefined
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <ShieldCheck size={32} className="text-[color:var(--sec-accent)]" />
          <p className="text-[length:var(--t-body)] font-normal text-[color:var(--sec-text)]">
            Thanks — an admin will review this {noun}.
          </p>
          <p className="text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            You won&rsquo;t be told who reported what. If you&rsquo;d rather not see it in the
            meantime, hide it from the ··· menu.
          </p>
        </div>
      ) : !reason ? (
        <div className="flex flex-col pb-1">
          <p className="pb-2 text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            What&rsquo;s wrong with it?
          </p>

          {REPORT_REASONS.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => setReason(r.code)}
              className="flex min-h-[44px] items-center gap-3 border-b border-[color:var(--hair)] py-[var(--row-pv)] text-left transition last:border-b-0 hover:bg-[color:var(--sec-surface-2)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
                  {r.label}
                </span>
                <span className="block truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
                  {r.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3 pb-1">
          <div className="flex items-center gap-2 rounded-[var(--r-ui)] border border-[color:color-mix(in_srgb,var(--sec-accent)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--sec-accent)_12%,transparent)] px-3 py-2.5">
            <Check size={16} className="shrink-0 text-[color:var(--sec-accent)]" />
            <span className="text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
              {REPORT_REASONS.find((r) => r.code === reason)?.label}
            </span>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
              Anything else we should know? (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={4}
              placeholder="Add any detail that would help an admin."
              className="w-full rounded-[var(--r-ui)] border border-[color:var(--hair-panel)] bg-[color:var(--sec-surface)] px-3 py-2 text-[length:var(--t-body)] font-normal text-[color:var(--sec-text)] placeholder:text-[color:var(--sec-muted)] outline-none focus:ring-2 focus:ring-[color:var(--sec-accent)]"
            />
            <span className="mt-1 block text-right text-[length:var(--t-label)] font-normal tabular-nums text-[color:var(--sec-muted)]">
              {note.length}/500
            </span>
          </label>

          {error ? (
            <div className="text-[length:var(--t-sec)] font-normal text-[color:var(--sec-bad)]">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

// lib/social/report.ts
//
// The client half of content reporting. The server half — reportContent() in
// lib/feed/commands.ts and POST /api/reports — has been complete and working
// since the feed shipped, with nothing in the app ever calling it. This file
// existed as an empty placeholder for exactly this.
//
// docs/legal-compliance.md lists Online Safety Act reporting as live against
// the policy pages; this is the product surface that makes that true.

import { authedFetch } from "@/lib/social/api";

export type ReportTargetType = "feed_item" | "comment";

export type ReportReasonCode =
  | "spam"
  | "harassment"
  | "hate"
  | "violence"
  | "sexual"
  | "self_harm"
  | "illegal"
  | "impersonation"
  | "copyright"
  | "other";

/**
 * The list shown in the report sheet, in the order shown.
 *
 * A fixed vocabulary rather than a free-text box alone: it makes the queue
 * triageable, it lets the urgent categories sort to the top, and it means a
 * reporter doesn't have to find words for something they'd rather not describe.
 */
export const REPORT_REASONS: Array<{
  code: ReportReasonCode;
  label: string;
  description: string;
}> = [
  { code: "spam", label: "Spam or scam", description: "Unwanted promotion, or a link to something dodgy" },
  { code: "harassment", label: "Harassment or bullying", description: "Targeted at someone in the society" },
  { code: "hate", label: "Hate speech", description: "Attacks a person or group over who they are" },
  { code: "violence", label: "Violence or threats", description: "Threatens or glorifies harm" },
  { code: "sexual", label: "Sexual content", description: "Explicit or otherwise not for this feed" },
  { code: "self_harm", label: "Self-harm or suicide", description: "Someone may be at risk" },
  { code: "illegal", label: "Something illegal", description: "Breaks the law" },
  { code: "impersonation", label: "Impersonation", description: "Pretending to be someone else" },
  { code: "copyright", label: "Copyright", description: "Uses work that isn't theirs" },
  { code: "other", label: "Something else", description: "Tell us what's wrong" },
];

export async function reportContent(params: {
  targetType: ReportTargetType;
  targetId: string;
  reasonCode: ReportReasonCode;
  note?: string;
}): Promise<{ report_id: string }> {
  const res = await authedFetch("/api/reports", {
    method: "POST",
    body: JSON.stringify({
      target_type: params.targetType,
      target_id: params.targetId,
      reason_code: params.reasonCode,
      // The server falls back to the code when the note is blank —
      // feed_reports.reason is NOT NULL and reportContent() rejects an empty one.
      reason: params.note?.trim() || undefined,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error((payload as any)?.error ?? "Couldn't send that report.");
  }

  return (await res.json()) as { report_id: string };
}

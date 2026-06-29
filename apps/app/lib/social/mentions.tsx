import type { ReactNode } from "react";

/**
 * Highlight @mentions in body text using the provided tagged names.
 * Mentioned handles render in blue. Shared by posts (FeedCard) and comments.
 */
export function renderWithMentions(
  text: string,
  tagged: Array<{ name?: string | null }> | null | undefined,
): ReactNode {
  const names = (tagged ?? []).map((t) => t?.name).filter((n): n is string => !!n);
  if (names.length === 0) return text;

  const escaped = names
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(?:${escaped.join("|")})`, "g");

  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={key++} className="font-bold text-sky-400">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

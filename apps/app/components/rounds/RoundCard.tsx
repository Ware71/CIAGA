import Link from "next/link";
import { CARD_INTERACTIVE, Tag } from "@/components/ui/chrome";
import { cn } from "@/lib/utils";

/**
 * A round on the /play hub: what it is, where you're playing it and from which
 * tee, and when.
 *
 * A `Row` couldn't carry this. Its single sub-line had to hold the course, the
 * date and the swipe hint at once, all inside one truncating span, so on a phone
 * you saw the course and an ellipsis. Three lines of its own is the least this
 * needs, which makes it a card rather than a row.
 *
 * The tee matters enough to sit on the face of the card because it is the one
 * field that is *yours* — everyone in a fourball sees a different value here.
 */
export function RoundCard({
  href,
  title,
  status,
  live = false,
  course,
  tee,
  when,
  footnote,
}: {
  href: string;
  title: string;
  /** Short status word — Live, Draft, Scheduled, or a competition type. */
  status: string;
  live?: boolean;
  course: string | null;
  /** The viewer's tee, not the round's. */
  tee: string | null;
  when: string | null;
  /** Quiet last line: the swipe hint, or where a Majors round is managed. */
  footnote?: React.ReactNode;
}) {
  // "Course · Tee", but never a bare orphan separator when one is missing.
  const place = [course, tee].filter(Boolean).join(" · ");

  return (
    <Link
      href={href}
      className={cn(
        CARD_INTERACTIVE,
        // No outer margin: on /play each card is wrapped by a swipe container
        // whose overflow-hidden would otherwise expose the delete rail in the gap.
        // The list owns the spacing.
        "relative block px-3 py-2.5",
        // The accent stripe is the same "this one is live" signal Row uses, so
        // the two read as one system where they appear on the same screen.
        live && "pl-[13px]"
      )}
    >
      {live && (
        <span
          aria-hidden="true"
          className="absolute bottom-2.5 left-0 top-2.5 w-[2px] rounded-full bg-[color:var(--sec-accent)]"
        />
      )}

      <div className="flex items-start justify-between gap-2.5">
        <span className="min-w-0 truncate text-[length:var(--t-body)] font-medium text-[color:var(--sec-text)]">
          {title}
        </span>
        <span className="shrink-0">
          <Tag on={live}>{status}</Tag>
        </span>
      </div>

      <div className="mt-[3px] truncate text-[length:var(--t-sec)] text-[color:var(--sec-muted)]">
        {place || "Course not set"}
      </div>

      {when ? (
        <div className="mt-[2px] truncate text-[length:var(--t-sec)] tabular-nums text-[color:var(--sec-text-2)]">
          {when}
        </div>
      ) : null}

      {footnote ? (
        <div className="mt-[6px] text-[length:var(--t-label)] text-[color:var(--sec-muted)]">
          {footnote}
        </div>
      ) : null}
    </Link>
  );
}

export default RoundCard;

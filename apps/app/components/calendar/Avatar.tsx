"use client";

import { cn } from "@/lib/utils";
import { ownerColor } from "./eventStyles";

/** Small initials avatar tinted per-owner, matching the InvitePlayerSheet look. */
export function InitialsAvatar(props: {
  profileId: string;
  name: string | null;
  size?: number;
  className?: string;
}) {
  const { profileId, name, size = 20, className } = props;
  const initials = (name?.trim()?.slice(0, 2) ?? "??").toUpperCase();
  const tint = ownerColor(profileId);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        backgroundColor: `${tint}22`,
        color: tint,
        border: `1px solid ${tint}55`,
      }}
      title={name ?? "Player"}
    >
      {initials}
    </span>
  );
}

/** Overlapping stack of initials avatars for cards with multiple people. */
export function AvatarStack(props: {
  people: { seed: string; name: string | null }[];
  size?: number;
  max?: number;
  className?: string;
}) {
  const { people, size = 14, max = 3, className } = props;
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={cn("flex shrink-0 items-center -space-x-1.5", className)}>
      {shown.map((p, i) => (
        <span key={`${p.seed}-${i}`} className="rounded-full ring-1 ring-black/30">
          <InitialsAvatar profileId={p.seed} name={p.name} size={size} />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="inline-flex items-center justify-center rounded-full bg-black/40 font-semibold text-white ring-1 ring-black/30"
          style={{ width: size, height: size, fontSize: size * 0.42 }}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

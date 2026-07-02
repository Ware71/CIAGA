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

"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

type ProfileRow = {
  id: string;
  owner_user_id?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

type Props = {
  isMe: boolean;
  profile: ProfileRow;
  avatarUrl: string;
  initials: string;
  titleName: string;
  hiText: string;
  hiSub: string;
  followersCount: number;
  followingCount: number;
  // Follow
  isFollowing: boolean;
  canFollow: boolean;
  busy: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onOpenList: (mode: "followers" | "following") => void;
  // Name editor (self only)
  editingName: boolean;
  displayName: string;
  savingName: boolean;
  onEditName: () => void;
  onCancelEditName: () => void;
  onDisplayNameChange: (val: string) => void;
  onSaveDisplayName: () => void;
  // Avatar upload (self only)
  uploading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onPickFile: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

export default function ProfileHeader({
  isMe,
  profile,
  avatarUrl,
  initials,
  titleName,
  hiText,
  hiSub,
  followersCount,
  followingCount,
  isFollowing,
  canFollow,
  busy,
  onFollow,
  onUnfollow,
  onOpenList,
  editingName,
  displayName,
  savingName,
  onEditName,
  onCancelEditName,
  onDisplayNameChange,
  onSaveDisplayName,
  uploading,
  fileRef,
  onPickFile,
  onFileChange,
}: Props) {
  return (
    <>
      {/* Profile content */}
      <div className="mt-4 flex flex-col items-center">
        <Avatar className="h-24 w-24 border border-emerald-200/70 shadow-lg">
          <AvatarImage src={avatarUrl} />
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>

        {/* NAME: self -> editable, public -> static */}
        {!isMe ? (
          <div className="mt-4 text-base font-semibold text-[#f5e6b0] max-w-[280px] truncate text-center">
            {titleName}
          </div>
        ) : !editingName ? (
          <div className="mt-4 flex items-center justify-center gap-2 max-w-[280px]">
            <div className="text-base font-semibold text-[#f5e6b0] truncate text-center">
              {profile?.name || titleName}
            </div>
            <button
              type="button"
              className="text-emerald-300 hover:text-emerald-200 text-sm"
              onClick={onEditName}
              title="Edit display name"
              aria-label="Edit display name"
            >
              ✎
            </button>
          </div>
        ) : (
          <div className="mt-3 w-full max-w-sm">
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Display name</div>
              <input
                value={displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                placeholder="Set your display name"
                maxLength={30}
                autoFocus
                className="mt-2 w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-sm outline-none placeholder:text-emerald-200/40"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-3 text-emerald-100 hover:bg-emerald-900/30"
                  onClick={onCancelEditName}
                >
                  Cancel
                </Button>

                <Button
                  size="sm"
                  onClick={onSaveDisplayName}
                  disabled={savingName || !displayName.trim()}
                  className="h-8 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                >
                  {savingName ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Follow button (public only) */}
        {canFollow && (
          <div className="mt-3">
            {isFollowing ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className="rounded-xl border-red-900 bg-transparent text-red-200 hover:bg-red-950/60"
                onClick={onUnfollow}
              >
                {busy ? "..." : "Unfollow"}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                onClick={onFollow}
              >
                {busy ? "..." : "Follow"}
              </Button>
            )}
          </div>
        )}

        {/* Self: avatar upload */}
        {isMe && (
          <div className="mt-2">
            <input
              type="file"
              ref={fileRef}
              accept="image/*"
              className="hidden"
              onChange={onFileChange}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-emerald-200/70 hover:text-emerald-100 hover:bg-emerald-900/30 text-xs"
              onClick={onPickFile}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Change photo"}
            </Button>
          </div>
        )}

        {/* Followers / Following counts */}
        <div className="mt-3 flex gap-6 text-center">
          <button
            type="button"
            className="text-center hover:opacity-80"
            onClick={() => onOpenList("followers")}
          >
            <div className="text-lg font-semibold text-emerald-50">{followersCount}</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-100/60">Followers</div>
          </button>
          <button
            type="button"
            className="text-center hover:opacity-80"
            onClick={() => onOpenList("following")}
          >
            <div className="text-lg font-semibold text-emerald-50">{followingCount}</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-100/60">Following</div>
          </button>
        </div>

        {/* Handicap Index card */}
        <div className="mt-4 w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-center">
          <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Handicap Index</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-50">{hiText}</div>
          {hiSub && <div className="mt-1 text-xs text-emerald-100/60">{hiSub}</div>}
        </div>
      </div>
    </>
  );
}

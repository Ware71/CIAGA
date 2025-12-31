"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

type User = {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
};

const AVATAR_BUCKET = "avatars";

export default function ProfilePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // placeholders for now — later read these from your DB
  const [followersCount] = useState<number>(0);
  const [followingCount] = useState<number>(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser((data.user as any) ?? null);
      setLoading(false);
    });
  }, []);

  const name = user?.user_metadata?.full_name || user?.email || "Player";
  const initials = (name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const avatarUrl = user?.user_metadata?.avatar_url || "";

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file || !user) return;

      if (!file.type.startsWith("image/")) return;

      setUploading(true);

      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });

      if (updateError) throw updateError;

      setUser((prev) =>
        prev
          ? (({
              ...prev,
              user_metadata: { ...(prev.user_metadata || {}), avatar_url: publicUrl },
            } as any) as User)
          : prev
      );
    } catch (err) {
      console.error("Avatar upload failed:", err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>

            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                Account
              </div>
            </div>

            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            Loading…
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>

            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                Account
              </div>
            </div>

            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            You’re not signed in.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header — MATCHES COURSES */}
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Profile</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              Account
            </div>
          </div>

          {/* spacer to keep title centered */}
          <div className="w-[60px]" />
        </header>

        {/* Content */}
        <div className="mt-4 flex flex-col items-center">
          <Avatar className="h-24 w-24 border border-emerald-200/70 shadow-lg">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>

          <div className="mt-4 text-base font-semibold text-[#f5e6b0] truncate max-w-[280px] text-center">
            {name}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChange}
          />

          <Button
            onClick={onPickFile}
            disabled={uploading}
            className="mt-4 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
          >
            {uploading ? "Uploading…" : "Change profile picture"}
          </Button>

          <div className="mt-6 w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <div className="grid grid-cols-2 divide-x divide-emerald-900/70 text-center">
              <div className="px-2">
                <div className="text-lg font-semibold text-emerald-50">{followersCount}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  Followers
                </div>
              </div>

              <div className="px-2">
                <div className="text-lg font-semibold text-emerald-50">{followingCount}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  Following
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 w-full text-xs text-emerald-100/70 text-center">
            More profile stats coming soon.
          </div>
        </div>
      </div>
    </div>
  );
}

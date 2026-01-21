// components/social/PostComposer.tsx
"use client";

import { useState } from "react";
import { createPost } from "@/lib/social/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  onPosted?: () => void;
};

export default function PostComposer({ onPosted }: Props) {
  const [text, setText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePost() {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsPosting(true);
    setError(null);

    try {
      await createPost({
        audience: "followers",
        text: trimmed,
        image_urls: null,
      });
      setText("");
      onPosted?.();
    } catch (e: any) {
      setError(e?.message ?? "Failed to post");
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 shadow-sm space-y-3">
      <div>
        <div className="text-sm font-extrabold text-emerald-50">Post</div>
        <div className="text-[11px] font-semibold text-emerald-100/55">Share an update with followers</div>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What’s happening?"
        className="min-h-[90px] bg-[#042713] border-emerald-900/70 text-emerald-50 placeholder:text-emerald-100/40"
      />

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-emerald-100/60">
          {error ? <span className="text-red-200">{error}</span> : null}
        </div>

        <Button
          onClick={handlePost}
          disabled={isPosting || text.trim().length === 0}
          className="bg-[#f5e6b0] text-[#042713] hover:bg-[#f5e6b0]/90 font-extrabold"
        >
          {isPosting ? "Posting…" : "Post"}
        </Button>
      </div>
    </div>
  );
}

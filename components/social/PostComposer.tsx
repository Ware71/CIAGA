// components/social/PostComposer.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { createPost } from "@/lib/social/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabaseClient";

type Props = {
  onPosted?: () => void;
  onCancel?: () => void;
};

type UploadingImage = {
  file: File;
  previewUrl: string;
};

function uniqueName(original: string) {
  const ext = original.includes(".") ? original.split(".").pop() : "jpg";
  const base = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${base}.${ext}`;
}

export default function PostComposer({ onPosted, onCancel }: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<UploadingImage[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canPost = useMemo(() => {
    const hasText = text.trim().length > 0;
    const hasImages = images.length > 0;
    return (hasText || hasImages) && !isPosting && !isUploading;
  }, [text, images.length, isPosting, isUploading]);

  function pickImages() {
    fileInputRef.current?.click();
  }

  function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;

    const next: UploadingImage[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const previewUrl = URL.createObjectURL(f);
      next.push({ file: f, previewUrl });
    }

    if (next.length === 0) return;

    setImages((prev) => {
      // cap to 4 images to keep UI tidy
      const merged = [...prev, ...next].slice(0, 4);
      return merged;
    });

    // allow selecting same file again
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(idx: number) {
    setImages((prev) => {
      const next = [...prev];
      const removed = next.splice(idx, 1)[0];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  async function uploadImagesToStorage(): Promise<string[]> {
    if (images.length === 0) return [];

    setIsUploading(true);
    try {
      // Ensure logged in so storage rules can apply
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const urls: string[] = [];

      for (const img of images) {
        const path = `posts/${uniqueName(img.file.name)}`;

        const { error: upErr } = await supabase.storage
          .from("post-images")
          .upload(path, img.file, {
            cacheControl: "3600",
            upsert: false,
            contentType: img.file.type,
          });

        if (upErr) throw upErr;

        // Public URL (bucket can be public OR policy allows read)
        const { data } = supabase.storage.from("post-images").getPublicUrl(path);
        const publicUrl = data.publicUrl;

        if (!publicUrl) throw new Error("Failed to get image URL");
        urls.push(publicUrl);
      }

      return urls;
    } finally {
      setIsUploading(false);
    }
  }

  async function handlePost() {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;

    setIsPosting(true);
    setError(null);

    try {
      const image_urls = await uploadImagesToStorage();

      await createPost({
        audience: "followers",
        text: trimmed,
        image_urls: image_urls.length > 0 ? image_urls : null,
      });

      // cleanup previews
      for (const img of images) {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
      }

      setText("");
      setImages([]);
      onPosted?.();
    } catch (e: any) {
      setError(e?.message ?? "Failed to post");
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 shadow-sm space-y-3">
      {/* Caption */}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a caption…"
        className="min-h-[90px] bg-[#042713] border-emerald-900/70 text-emerald-50 placeholder:text-emerald-100/40"
      />

      {/* Image picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onFilesSelected(e.target.files)}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="bg-emerald-900/35 text-emerald-50 hover:bg-emerald-900/50 font-extrabold"
            onClick={pickImages}
            disabled={isPosting || isUploading}
          >
            Add images
          </Button>

          <div className="text-xs font-semibold text-emerald-100/60">
            {images.length > 0 ? `${images.length}/4 selected` : "Up to 4"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              className="text-emerald-100 hover:bg-emerald-900/30 font-semibold"
              onClick={onCancel}
              disabled={isPosting || isUploading}
            >
              Cancel
            </Button>
          ) : null}

          <Button
            type="button"
            onClick={handlePost}
            disabled={!canPost}
            className="bg-[#f5e6b0] text-[#042713] hover:bg-[#f5e6b0]/90 font-extrabold"
          >
            {isUploading ? "Uploading…" : isPosting ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>

      {/* Previews */}
      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 pt-1">
          {images.map((img, idx) => (
            <div
              key={img.previewUrl}
              className="relative overflow-hidden rounded-xl border border-emerald-900/60 bg-[#042713]"
            >
              <img
                src={img.previewUrl}
                alt=""
                className="h-28 w-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-1 text-xs font-extrabold text-white hover:bg-black/75"
                aria-label="Remove image"
                title="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Errors */}
      {error ? (
        <div className="text-xs font-semibold text-red-200">{error}</div>
      ) : null}
    </div>
  );
}

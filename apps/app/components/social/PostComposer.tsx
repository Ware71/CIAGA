// components/social/PostComposer.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { createPost } from "@/lib/social/api";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import MentionInput, { type Mention } from "@/components/social/MentionInput";
import {
  ImageCompressionError,
  compressImage,
  formatBytes,
  outputExtension,
  type CompressedImage,
} from "@/lib/media/compressImage";
import { MAX_POST_MEDIA } from "@/lib/feed/schemas";
import type { FeedMedia } from "@/lib/feed/types";

const BUCKET = "post-images";

type Props = {
  onPosted?: () => void;
  onCancel?: () => void;
};

type PendingImage = {
  /** Stable key for React, independent of the object URL. */
  id: string;
  compressed: CompressedImage;
  /** Preview is made from the COMPRESSED blob, so what you see is what posts. */
  previewUrl: string;
};

function friendlyUploadError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");

  // The bucket not existing is exactly the failure this whole feature was
  // built to fix, so say something a member can act on rather than passing
  // Supabase's wording through.
  if (/bucket not found/i.test(message)) {
    return "Photo uploads aren't switched on for this environment yet.";
  }
  if (/payload too large|exceeded the maximum|size limit/i.test(message)) {
    return "That photo is too large to upload even after compressing.";
  }
  if (/mime type|not supported/i.test(message)) {
    return "That file type can't be uploaded.";
  }
  if (/row-level security|unauthorized|jwt/i.test(message)) {
    return "You need to be signed in to add photos.";
  }
  return message || "Couldn't upload that photo.";
}

export default function PostComposer({ onPosted, onCancel }: Props) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [compressing, setCompressing] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = isPosting || isUploading || compressing !== null;

  const canPost = useMemo(() => {
    return (text.trim().length > 0 || images.length > 0) && !busy;
  }, [text, images.length, busy]);

  const savings = useMemo(() => {
    if (images.length === 0) return null;
    const before = images.reduce((n, i) => n + i.compressed.originalBytes, 0);
    const after = images.reduce(
      (n, i) => n + i.compressed.full.blob.size + i.compressed.feed.blob.size,
      0,
    );
    if (after >= before) return null;
    return `${formatBytes(before)} → ${formatBytes(after)}`;
  }, [images]);

  function pickImages() {
    fileInputRef.current?.click();
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);

    const room = MAX_POST_MEDIA - images.length;
    const files = Array.from(fileList).slice(0, Math.max(0, room));

    // Reset the input first so picking the same file twice still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;

    setCompressing({ done: 0, total: files.length });

    const accepted: PendingImage[] = [];
    const problems: string[] = [];

    for (const [index, file] of files.entries()) {
      try {
        const compressed = await compressImage(file);
        accepted.push({
          id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
          compressed,
          previewUrl: URL.createObjectURL(compressed.feed.blob),
        });
      } catch (e) {
        // One bad photo shouldn't discard the rest of the selection.
        problems.push(
          e instanceof ImageCompressionError ? e.message : `Couldn't read "${file.name}".`,
        );
      } finally {
        setCompressing({ done: index + 1, total: files.length });
      }
    }

    setCompressing(null);
    if (accepted.length > 0) setImages((prev) => [...prev, ...accepted]);
    if (problems.length > 0) setError(problems.join(" "));
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  /**
   * Uploads both variants of every image in parallel.
   *
   * Path is `<auth user id>/<uuid>.<ext>` — the auth uid, not the profile id,
   * because that is all the storage RLS policy can see. See migration
   * 20260903000000_post_images_bucket.sql.
   */
  async function uploadImages(): Promise<FeedMedia[]> {
    if (images.length === 0) return [];

    const { data: sess } = await supabase.auth.getSession();
    const authUserId = sess.session?.user?.id;
    if (!authUserId) throw new Error("You need to be signed in to add photos.");

    const ext = outputExtension();
    const uploaded: string[] = [];

    const putObject = async (path: string, blob: Blob, contentType: string) => {
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
        // The object name is a uuid, so its bytes can never change — cache it
        // for a year instead of revalidating hourly.
        cacheControl: "31536000",
        upsert: false,
        contentType,
      });
      if (upErr) throw upErr;
      uploaded.push(path);
      return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    };

    setIsUploading(true);
    try {
      return await Promise.all(
        images.map(async (img) => {
          const key = `${authUserId}/${crypto.randomUUID()}`;
          const [url, thumbUrl] = await Promise.all([
            putObject(`${key}.${ext}`, img.compressed.full.blob, img.compressed.full.type),
            putObject(`${key}_t.${ext}`, img.compressed.feed.blob, img.compressed.feed.type),
          ]);

          return {
            kind: "image" as const,
            url,
            thumb_url: thumbUrl,
            w: img.compressed.full.width,
            h: img.compressed.full.height,
            provider: "supabase" as const,
          };
        }),
      );
    } catch (e) {
      // Don't leave half a post's photos orphaned in the bucket paying for
      // storage nothing will ever render.
      if (uploaded.length > 0) {
        void supabase.storage.from(BUCKET).remove(uploaded).catch(() => {});
      }
      throw e;
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
      const media = await uploadImages();

      // Only keep mentions still present in the final text.
      const finalMentions = mentions.filter((m) => trimmed.includes(`@${m.name}`));

      await createPost({
        audience: "followers",
        text: trimmed,
        media: media.length > 0 ? media : null,
        tagged_profiles: finalMentions.length > 0 ? finalMentions : null,
      });

      for (const img of images) URL.revokeObjectURL(img.previewUrl);

      setText("");
      setMentions([]);
      setImages([]);
      onPosted?.();
    } catch (e) {
      setError(friendlyUploadError(e));
    } finally {
      setIsPosting(false);
    }
  }

  const statusLine = compressing
    ? `Compressing ${compressing.done} of ${compressing.total}…`
    : savings
      ? `${images.length} photo${images.length === 1 ? "" : "s"} · ${savings}`
      : images.length > 0
        ? `${images.length} of ${MAX_POST_MEDIA}`
        : `Up to ${MAX_POST_MEDIA} photos`;

  return (
    <div className="space-y-3">
      <MentionInput
        value={text}
        onChange={setText}
        mentions={mentions}
        onMentionsChange={setMentions}
        placeholder="Add a caption… use @ to tag people"
        className="w-full min-h-[90px] rounded-[var(--r-ui)] border border-[color:var(--hair-panel)] bg-[color:var(--ciaga-ground)] px-3 py-2 text-[length:var(--t-body)] font-normal text-[color:var(--sec-text)] placeholder:text-[color:var(--sec-muted)] outline-none focus:ring-2 focus:ring-[color:var(--sec-accent)]"
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => void onFilesSelected(e.target.files)}
      />

      {/* Previews — from the compressed blob, so this is exactly what posts. */}
      {images.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="relative overflow-hidden rounded-[var(--r-ui)] border border-[color:var(--hair-panel)] bg-[color:var(--ciaga-ground)]"
            >
              <img
                src={img.previewUrl}
                alt=""
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                aria-label={`Remove photo`}
                disabled={busy}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5 bg-[color:var(--sec-surface)] text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
            onClick={pickImages}
            disabled={busy || images.length >= MAX_POST_MEDIA}
          >
            <ImagePlus size={16} />
            Photos
          </Button>

          <div className="truncate text-[length:var(--t-sec)] font-normal text-[color:var(--sec-muted)]">
            {statusLine}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </Button>
          ) : null}

          <Button
            type="button"
            size="sm"
            onClick={handlePost}
            disabled={!canPost}
            pending={isPosting}
            className="bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] hover:bg-[color:color-mix(in_srgb,var(--sec-accent)_90%,transparent)] font-medium"
          >
            {isUploading ? "Uploading…" : "Post"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="text-[length:var(--t-sec)] font-normal text-[color:var(--sec-bad)]">
          {error}
        </div>
      ) : null}
    </div>
  );
}

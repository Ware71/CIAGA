"use client";

import { useState } from "react";
import MediaLightbox from "@/components/social/MediaLightbox";
import type { FeedMedia } from "@/lib/feed/types";

/**
 * The photo grid on a post.
 *
 * What it replaces: a `grid-cols-2` of fixed `h-36` tiles, which cropped every
 * photo to a 144px band whatever its shape — a portrait of someone on the tee
 * and a wide shot down the fairway came out as identical letterbox slots. That
 * was the single loudest reason the feed didn't look like a real product.
 *
 * Rules, borrowed from what Facebook and X converged on:
 *   1     the photo's own aspect ratio, clamped so neither extreme takes over
 *   2     two squares
 *   3     one tall, two stacked
 *   4+    a 2×2, with the remainder counted on the last tile
 */
export default function PostMedia({ media }: { media: FeedMedia[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (media.length === 0) return null;

  const tiles = media.slice(0, 4);
  const overflow = media.length - tiles.length;

  return (
    <>
      {/* -mx-3 cancels the card's gutter so media bleeds to the card edge; the
          card root clips the corners. */}
      <div className="-mx-3 mt-3 overflow-hidden border-y border-[color:var(--hair)]">
        {media.length === 1 ? (
          <Tile item={media[0]} onOpen={() => setLightboxIndex(0)} ratio={singleRatio(media[0])} />
        ) : media.length === 2 ? (
          <div className="grid grid-cols-2 gap-[2px]">
            {tiles.map((m, i) => (
              <Tile key={m.url} item={m} onOpen={() => setLightboxIndex(i)} square />
            ))}
          </div>
        ) : media.length === 3 ? (
          <div className="grid aspect-[3/2] grid-cols-2 grid-rows-2 gap-[2px]">
            <div className="row-span-2 min-h-0">
              <Tile item={tiles[0]} onOpen={() => setLightboxIndex(0)} fill />
            </div>
            <Tile item={tiles[1]} onOpen={() => setLightboxIndex(1)} fill />
            <Tile item={tiles[2]} onOpen={() => setLightboxIndex(2)} fill />
          </div>
        ) : (
          <div className="grid grid-cols-2 grid-rows-2 gap-[2px]">
            {tiles.map((m, i) => (
              <Tile
                key={m.url}
                item={m}
                onOpen={() => setLightboxIndex(i)}
                square
                overlay={i === 3 && overflow > 0 ? `+${overflow}` : undefined}
              />
            ))}
          </div>
        )}
      </div>

      <MediaLightbox media={media} index={lightboxIndex} onClose={() => setLightboxIndex(null)} />
    </>
  );
}

/**
 * A single photo's display ratio, clamped to [4/5, 16/9]: without the floor a
 * portrait phone photo eats three screens of feed, and without the ceiling a
 * panorama becomes an unreadable slit. Legacy posts have no stored dimensions
 * and fall back to 4/3.
 */
function singleRatio(item: FeedMedia): number {
  const w = typeof item.w === "number" ? item.w : 0;
  const h = typeof item.h === "number" ? item.h : 0;
  if (w <= 0 || h <= 0) return 4 / 3;
  return Math.min(16 / 9, Math.max(4 / 5, w / h));
}

function Tile({
  item,
  onOpen,
  ratio,
  square,
  fill,
  overlay,
}: {
  item: FeedMedia;
  onOpen: () => void;
  ratio?: number;
  square?: boolean;
  fill?: boolean;
  overlay?: string;
}) {
  // thumb_url is the 900px variant; url is the 1600px one the lightbox opens.
  // Older posts only have the single URL.
  const src = item.thumb_url ?? item.url;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "relative block w-full overflow-hidden bg-[color:var(--sec-surface)]",
        square ? "aspect-square" : "",
        fill ? "h-full" : "",
      ].join(" ")}
      style={ratio ? { aspectRatio: String(ratio) } : undefined}
      aria-label="View photo"
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={item.w ?? undefined}
        height={item.h ?? undefined}
        className="h-full w-full object-cover"
      />

      {overlay ? (
        <span className="absolute inset-0 grid place-items-center bg-black/55 text-[length:var(--t-fig)] font-semibold text-white">
          {overlay}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Normalise a post payload's attachments.
 *
 * `media` is authoritative when present; older posts only have the flat
 * `image_urls`, so synthesise the same shape from those and let everything
 * downstream deal in one type.
 */
export function mediaFromPayload(payload: any): FeedMedia[] {
  if (Array.isArray(payload?.media) && payload.media.length > 0) {
    return payload.media as FeedMedia[];
  }

  const urls: unknown =
    payload?.image_urls ?? payload?.photo_urls ?? payload?.image_url ?? payload?.photo_url;

  if (typeof urls === "string") {
    return [{ kind: "image", url: urls }];
  }
  if (Array.isArray(urls)) {
    return urls
      .filter((u): u is string => typeof u === "string" && u.length > 0)
      .map((url) => ({ kind: "image" as const, url }));
  }

  return [];
}

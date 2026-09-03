// lib/media/compressImage.ts
//
// Client-side image compression for social post uploads.
//
// Why this exists at all: the project is on the Supabase free plan, which has no
// server-side image transformation (that's Pro-only) and a 1 GB / 5 GB-a-month
// storage-and-egress allowance. So the browser has to hand Storage a file that
// is already exactly the right size — there is no CDN behind it that will resize
// on the way out.
//
// Every photo produces TWO encodes:
//
//   feed  900px max edge  — what the card renders. ~120 KB.
//   full  1600px max edge — what the lightbox renders. ~350 KB.
//
// Together that's about half a megabyte per photo, so ~1,900 photos fit in the
// free tier, and scrolling the feed costs 120 KB an image rather than 350 KB.
// The second encode is the cheap half of the work — the decode dominates.
//
// Two things fall out of re-encoding through a canvas that are worth naming:
//
//   EXIF is stripped, including GPS. iPhone photos carry the coordinates of the
//   hole you were standing on, and these land in a PUBLIC bucket readable by
//   anyone with the URL. Dropping it is a data-minimisation requirement, not a
//   nice-to-have — see docs/legal-compliance.md.
//
//   HEIC converts for free on iOS/macOS Safari, where WebKit decodes it with the
//   OS codec. Chrome, Edge and Firefox refuse it; see `decode` below.

export type EncodedImage = {
  blob: Blob;
  width: number;
  height: number;
  type: OutputType;
};

export type CompressedImage = {
  /** 900px max edge — rendered in the feed card. */
  feed: EncodedImage;
  /** 1600px max edge — rendered in the lightbox. */
  full: EncodedImage;
  originalBytes: number;
  originalName: string;
};

export type OutputType = "image/webp" | "image/jpeg";

export type CompressionErrorCode =
  | "not_an_image"
  | "too_large"
  | "decode_failed"
  | "heic_unsupported"
  | "encode_failed";

export class ImageCompressionError extends Error {
  readonly code: CompressionErrorCode;

  constructor(code: CompressionErrorCode, message: string) {
    super(message);
    this.name = "ImageCompressionError";
    this.code = code;
  }
}

/** Anything larger than this is a mistake, not a photo. */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

const VARIANTS = {
  feed: { maxEdge: 900, targetBytes: 140 * 1024 },
  full: { maxEdge: 1600, targetBytes: 400 * 1024 },
} as const;

/**
 * Quality ladder. Three rungs, and we stop there even if we're still over
 * target — a 48MP panorama must not lock the main thread for a second and a
 * half chasing a byte count, and an image slightly over budget is a far better
 * outcome for the user than a rejected upload.
 */
const QUALITY_LADDER = [0.82, 0.66, 0.5] as const;

// ---- Format support ---------------------------------------------------------

let cachedOutputType: OutputType | null = null;

/**
 * Safari has encoded WebP since 14, so this is very nearly always webp. The
 * probe is cheap and runs once; the fallback keeps a stray old engine working
 * rather than failing the upload.
 */
function outputType(): OutputType {
  if (cachedOutputType) return cachedOutputType;

  let supported = false;
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    supported = probe.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    supported = false;
  }

  cachedOutputType = supported ? "image/webp" : "image/jpeg";
  return cachedOutputType;
}

export function outputExtension(): "webp" | "jpg" {
  return outputType() === "image/webp" ? "webp" : "jpg";
}

// ---- Decode -----------------------------------------------------------------

type DecodedSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

function looksLikeHeic(file: File) {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name);
}

/**
 * `imageOrientation: "from-image"` is load-bearing.
 *
 * A phone camera stores the sensor's pixels unrotated and records "turn this a
 * quarter turn" in EXIF. A canvas draws raw pixels, so without this flag every
 * portrait photo posts sideways — and because the re-encode drops the EXIF, the
 * viewer has nothing left to correct it with. Older engines default the flag to
 * "none" rather than "from-image", so pass it explicitly.
 *
 * The <img> fallback below is orientation-safe for free: the HTML image element
 * has applied EXIF rotation itself for years.
 */
async function decode(file: File): Promise<DecodedSource> {
  if (typeof createImageBitmap === "function") {
    for (const options of [{ imageOrientation: "from-image" as const }, undefined]) {
      try {
        const bitmap = await createImageBitmap(file, options);
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        };
      } catch {
        // Fall through: either the option is unrecognised (retry bare) or the
        // codec is missing (fall through to the <img> path, which sometimes
        // succeeds where createImageBitmap does not).
      }
    }
  }

  try {
    return await decodeViaImageElement(file);
  } catch {
    if (looksLikeHeic(file)) {
      throw new ImageCompressionError(
        "heic_unsupported",
        "This photo is in HEIC format, which this browser can't read. On iPhone, " +
          "Settings › Camera › Formats › Most Compatible makes new photos " +
          "shareable everywhere — or re-save this one as a JPEG.",
      );
    }
    throw new ImageCompressionError(
      "decode_failed",
      "That image couldn't be read. Try a JPEG or PNG.",
    );
  }
}

function decodeViaImageElement(file: File): Promise<DecodedSource> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };

    img.src = url;
  });
}

// ---- Encode -----------------------------------------------------------------

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: OutputType,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality });
  }

  const el = canvas as HTMLCanvasElement;
  return new Promise((resolve, reject) => {
    el.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      type,
      quality,
    );
  });
}

async function encodeVariant(
  decoded: DecodedSource,
  maxEdge: number,
  targetBytes: number,
): Promise<EncodedImage> {
  // Never upscale — a 400px photo stays 400px rather than being blown up and
  // re-compressed into something visibly worse than the original.
  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const useOffscreen = typeof OffscreenCanvas !== "undefined";
  const canvas: HTMLCanvasElement | OffscreenCanvas = useOffscreen
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });

  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;

  if (!ctx) {
    throw new ImageCompressionError("encode_failed", "Couldn't process that image.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(decoded.source, 0, 0, width, height);

  const type = outputType();
  let best: Blob | null = null;

  for (const quality of QUALITY_LADDER) {
    let blob: Blob;
    try {
      blob = await canvasToBlob(canvas, type, quality);
    } catch {
      throw new ImageCompressionError("encode_failed", "Couldn't process that image.");
    }

    // Lower quality is not guaranteed to be smaller on every encoder, so keep
    // whichever rung actually came out smallest.
    if (!best || blob.size < best.size) best = blob;
    if (blob.size <= targetBytes) break;
  }

  if (!best) {
    throw new ImageCompressionError("encode_failed", "Couldn't process that image.");
  }

  return { blob: best, width, height, type };
}

// ---- Public API -------------------------------------------------------------

/**
 * Decode once, encode twice. Throws `ImageCompressionError` with a `code` and a
 * message that is safe to show the user verbatim.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith("image/") && !looksLikeHeic(file)) {
    throw new ImageCompressionError("not_an_image", `"${file.name}" isn't an image.`);
  }

  if (file.size > MAX_INPUT_BYTES) {
    throw new ImageCompressionError(
      "too_large",
      `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_INPUT_BYTES)}.`,
    );
  }

  const decoded = await decode(file);
  try {
    // Sequential, not Promise.all: both encodes contend for the same main
    // thread, and running them together only makes the composer feel jankier.
    const full = await encodeVariant(decoded, VARIANTS.full.maxEdge, VARIANTS.full.targetBytes);
    const feed = await encodeVariant(decoded, VARIANTS.feed.maxEdge, VARIANTS.feed.targetBytes);

    return { feed, full, originalBytes: file.size, originalName: file.name };
  } finally {
    decoded.release();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Hub Image Utilities
 * -------------------
 * Client-side scaling/compression for profile avatars and space logos. Images
 * are downscaled to a small box and re-encoded (WebP with a JPEG fallback) so
 * IndexedDB records and the BYOS sync payload stay lightweight.
 *
 * `computeScaledDimensions` is pure and unit-tested; the canvas pipeline is a
 * thin, feature-detected wrapper.
 */

/** Default maximum edge length for stored images (px). */
export const MAX_IMAGE_SIZE = 256;

/** Default encoder quality (0-1). */
export const DEFAULT_IMAGE_QUALITY = 0.8;

export interface ScaledDimensions {
  width: number;
  height: number;
}

/**
 * Fit `width`x`height` inside a `maxSize` box, preserving aspect ratio. Never
 * upscales, and returns `{0,0}` for degenerate input.
 */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxSize: number = MAX_IMAGE_SIZE,
): ScaledDimensions {
  if (width <= 0 || height <= 0 || maxSize <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, maxSize / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface CompressImageOptions {
  maxSize?: number;
  quality?: number;
  mimeType?: string;
}

/** Load a `File` into a drawable bitmap. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be decoded.'));
    };
    image.src = url;
  });
}

/**
 * Read an image file and return a compressed data URL. Falls back to JPEG when
 * the browser cannot encode WebP.
 */
export async function compressImageFile(
  file: File,
  options: CompressImageOptions = {},
): Promise<string> {
  const maxSize = options.maxSize ?? MAX_IMAGE_SIZE;
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY;
  const mimeType = options.mimeType ?? 'image/webp';

  const bitmap = await loadBitmap(file);
  const { width, height } = computeScaledDimensions(bitmap.width, bitmap.height, maxSize);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  context.drawImage(bitmap, 0, 0, width, height);

  const encoded = canvas.toDataURL(mimeType, quality);
  // Some browsers silently fall back to PNG for unsupported types; re-encode
  // as JPEG when WebP was requested but not honoured.
  if (mimeType === 'image/webp' && !encoded.startsWith('data:image/webp')) {
    return canvas.toDataURL('image/jpeg', quality);
  }
  return encoded;
}

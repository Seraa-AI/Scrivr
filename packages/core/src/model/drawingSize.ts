import { safeDrawingUrl } from "./safeUrl";

/** JPEG start-of-frame markers — every one but DHT (C4), JPG (C8) and DAC (CC) carries the frame's size. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * The pixel size of a drawing — a signature or initials, an inline PNG or
 * JPEG as `safeDrawingUrl` accepts it — read from its own header, so it can
 * be fitted to a box in its proportions where no browser decodes it. `null`
 * for anything else, or a header that names no size.
 */
export function drawingSize(src: string): { width: number; height: number } | null {
  const url = safeDrawingUrl(src);
  if (url === null) return null;
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  const size = url.startsWith("data:image/png") ? pngSize(bytes) : jpegSize(bytes);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** A PNG's IHDR, which the format requires first: width and height at bytes 16–23. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A JPEG's frame header, found by walking its segments from the start. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 9 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (JPEG_FRAMES.has(marker)) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    at += 2 + view.getUint16(at + 2);
  }
  return null;
}

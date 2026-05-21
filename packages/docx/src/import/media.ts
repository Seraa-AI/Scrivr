/**
 * Materialize image bytes per the `media` option:
 *   - `data-url`  → base64 `data:` URL (universal)
 *   - `object-url` → `URL.createObjectURL(blob)` (browser-only)
 *   - `drop`      → no src; record a diagnostic so the caller can upload
 *
 * Returns a map `relId → src` that `DocxImportContext.media.resolveImage`
 * reads. Built once per import, before Stage 2 dispatch.
 */

import type { DocxDiagnostic } from "@scrivr/core";
import type { DocxMediaSink } from "@scrivr/core";
import type { DocxPackageReader } from "./opc";
import type { RelationshipMap } from "./relationships";

export function buildImageResolver(
  rels: RelationshipMap,
  pkg: DocxPackageReader,
  sink: DocxMediaSink,
  diagnostics: {
    warn(d: Omit<DocxDiagnostic, "level">): void;
    error(d: Omit<DocxDiagnostic, "level">): void;
  },
): (relId: string) => string | undefined {
  const cache = new Map<string, string>();
  return (relId) => {
    if (cache.has(relId)) return cache.get(relId);
    const rel = rels.get(relId);
    if (!rel || rel.type !== "image") return undefined;
    const partPath = `word/${rel.target}`;
    const bytes = pkg.readBytes(partPath);
    if (!bytes) {
      diagnostics.warn({
        code: "image-part-missing",
        message: `Image relationship "${relId}" points at "${partPath}" but the part is not in the package`,
        nodeType: "image",
      });
      return undefined;
    }
    if (sink === "drop") {
      diagnostics.warn({
        code: "image-dropped",
        message: `Image "${relId}" dropped per media: "drop"`,
        nodeType: "image",
      });
      return undefined;
    }
    const contentType = sniffContentType(bytes, rel.target);
    let src: string;
    if (sink === "object-url") {
      if (typeof URL === "undefined" || typeof Blob === "undefined") {
        diagnostics.warn({
          code: "object-url-unavailable",
          message: "media: \"object-url\" requested but Blob / URL are not available in this environment — falling back to data-url",
          nodeType: "image",
        });
        src = toDataUrl(bytes, contentType);
      } else {
        src = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: contentType }));
      }
    } else {
      src = toDataUrl(bytes, contentType);
    }
    cache.set(relId, src);
    return src;
  };
}

// ── MIME sniffing — match the export-side sniffer for consistency ──────────

function sniffContentType(bytes: Uint8Array, target: string): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // Fall back to extension hint.
  const ext = target.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

function toDataUrl(bytes: Uint8Array, contentType: string): string {
  // Use atob/btoa-equivalent path. Node has Buffer; browser has btoa
  // (but btoa only handles binary strings, so we encode chunkwise).
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(binary)
      : // Node fallback — Buffer is global in Node.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Buffer.from(bytes).toString("base64");
  return `data:${contentType};base64,${b64}`;
}

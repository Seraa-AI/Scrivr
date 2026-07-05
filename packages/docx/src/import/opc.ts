/**
 * Read an OPC (Open Packaging Conventions) ZIP — the format `.docx` uses.
 *
 * Wraps `fflate.unzipSync` so callers see a simple part-by-path API
 * without coupling to fflate's shape.
 */

import { unzipSync, strFromU8 } from "fflate";

export interface DocxPackageReader {
  /** All entry paths in the archive, in ZIP order. */
  list(): string[];
  /** Raw bytes for a part, or `undefined` if missing. */
  readBytes(path: string): Uint8Array | undefined;
  /** UTF-8 text for a part, or `undefined` if missing. */
  readText(path: string): string | undefined;
}

/**
 * Resolve an OPC relationship `Target` to an absolute package path, relative
 * to the source part that owns the relationship. Targets are relative to the
 * *part's directory*, not the package root — so an image referenced from
 * `word/header1.xml` and one from `word/document.xml` both resolve
 * `media/image1.png` against `word/`, while `../customXml/item1.xml` and a
 * package-absolute `/word/media/x.png` also land correctly.
 *
 * External targets (`http:`, `mailto:`, …) are returned unchanged — the caller
 * checks `targetMode === "External"` before pathing.
 */
export function resolveOpcTarget(sourcePartPath: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const slash = sourcePartPath.lastIndexOf("/");
  const segments = slash >= 0 ? sourcePartPath.slice(0, slash).split("/") : [];
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(seg);
  }
  return segments.join("/");
}

export function readDocxPackage(bytes: Uint8Array): DocxPackageReader {
  const entries = unzipSync(bytes);
  return {
    list() {
      return Object.keys(entries);
    },
    readBytes(path) {
      return entries[path];
    },
    readText(path) {
      const e = entries[path];
      return e ? strFromU8(e) : undefined;
    },
  };
}

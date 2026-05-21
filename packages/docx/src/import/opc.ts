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

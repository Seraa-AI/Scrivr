/**
 * OPC ZIP serializer for DOCX packages.
 *
 * Uses `fflate`'s synchronous zip API — small (~8KB), zero deps, browser
 * + Node compatible. Compression level 6 is a reasonable default; tests
 * read the bytes back via `unzipSync` for round-trip assertions.
 *
 * Determinism: `mtime: 0` on every entry so the same `DocxPackage` yields
 * identical bytes across runs — important for golden tests and any future
 * content-addressable storage of exported documents.
 */

import { zipSync, strToU8, type Zippable, type ZipOptions } from "fflate";
import type { DocxPackage } from "./context";

export type ZipCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ZipDocxOptions {
  /** Compression level 0-9. 0 = no compression (useful for test debugging). */
  level?: ZipCompressionLevel;
}

/**
 * Fixed mtime so identical input → identical bytes. ZIP epoch is 1980, so
 * we can't use Unix 0; pick the earliest legal DOS timestamp instead.
 */
const DETERMINISTIC_MTIME = new Date("1980-01-01T00:00:00Z");

export function zipDocxPackage(
  pkg: DocxPackage,
  options: ZipDocxOptions = {},
): Uint8Array {
  const files: Zippable = {};
  const attrs: ZipOptions = {
    mtime: DETERMINISTIC_MTIME,
    level: options.level ?? 6,
  };

  for (const part of pkg.parts) {
    const bytes = typeof part.data === "string" ? strToU8(part.data) : part.data;
    files[part.path] = [bytes, attrs];
  }

  return zipSync(files);
}

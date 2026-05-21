/**
 * DOCX export context + supporting types.
 *
 * `DocxContext` is the central state object threaded through handlers and
 * lifecycle hooks. It owns styles, numbering, relationships, media, and
 * shared cross-plugin derived data, plus a diagnostics channel and the
 * options bag.
 *
 * Resource registries are deterministic — `getOrCreate` semantics ensure
 * the same logical input returns the same ID across runs. Handlers should
 * never mutate package internals directly.
 */

import type { DocxDiagnostic } from "./handlers";

/** Minimal XML node — input to the deterministic serializer in `xml.ts`. */
export interface XmlNode {
  name: string;
  attributes?: Record<string, string>;
  children?: Array<XmlNode | string>;
}

/** One file inside the OPC ZIP. */
export interface DocxPackagePart {
  /** ZIP-relative path, e.g. `"word/document.xml"`. */
  path: string;
  /** MIME / OOXML content type, registered in `[Content_Types].xml`. */
  contentType?: string;
  /** Raw body — XML strings get UTF-8 encoded; binary parts pass through. */
  data: string | Uint8Array;
}

/**
 * Final DOCX output — the list of parts the ZIP serializer writes verbatim.
 * Custom `onFinalize` hooks may construct one of these directly to override
 * the default packager.
 */
export interface DocxPackage {
  parts: DocxPackagePart[];
}

export interface DocxStyleSpec {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

export interface DocxNumberingLevel {
  level: number;
  format: "bullet" | "decimal";
  text: string;
}

/** A binary media file (image, embedded object) registered in `word/media/`. */
export interface DocxMediaPart {
  /** ZIP-relative path inside `word/media/`, e.g. `"image1.png"`. */
  filename: string;
  contentType: string;
  data: Uint8Array;
}

/**
 * Behavior when the walker encounters a node type with no registered handler.
 *   - `"drop"`         — emit nothing, record a `warning` diagnostic. Default.
 *   - `"placeholder"`  — emit `[Unsupported Scrivr node: <type>]` as plain text.
 *   - `"throw"`        — abort export with `DocxExportError`.
 */
export type DocxUnsupportedPolicy = "drop" | "placeholder" | "throw";

/**
 * Fidelity dial. Currently advisory — only `"compatible"` is implemented in
 * the base walker. Feature PRs may branch on this when they ship lossy
 * mappings (e.g. anchored objects → inline fallback).
 *   - `"strict"`      — throw on any lossy mapping.
 *   - `"compatible"`  — produce conservative Word-compatible XML. Default.
 *   - `"best-effort"` — preserve as much as possible, may approximate.
 */
export type DocxFidelity = "strict" | "compatible" | "best-effort";

export interface DocxResolvedOptions {
  unsupported: DocxUnsupportedPolicy;
  fidelity: DocxFidelity;
}

/**
 * DOCX export context. Threaded through every handler and lifecycle hook.
 *
 * Design rules:
 *   - Handlers return XmlNode trees; no side-effect drawing, no global cursor.
 *   - Styles split by Word type to prevent invalid OOXML mixing.
 *   - Numbering is declarative; Word's abstractNum/numId are internal.
 *   - Media parts are registered separately from rels — rels reference media.
 *   - Diagnostics are append-only; the final list returns alongside `bytes`.
 *   - `ctx.shared` uses `getOrInit` (collaborative append) not `set` (overwrite).
 */
export interface DocxContext {
  /** Resolved export options — never undefined inside a handler. */
  readonly options: DocxResolvedOptions;

  /** Paragraph / character / table styles — getOrCreate deduplicates by name. */
  styles: {
    paragraph: { getOrCreate(name: string, spec: DocxStyleSpec): string };
    character: { getOrCreate(name: string, spec: DocxStyleSpec): string };
    table: { getOrCreate(name: string, spec: DocxStyleSpec): string };
  };

  /** Numbering — plugins describe intent, engine maps to Word internals. */
  numbering: {
    getOrCreate(config: {
      type: "bullet" | "ordered" | "task";
      levels: DocxNumberingLevel[];
    }): { numId: number };
  };

  /** OPC relationships — images, hyperlinks, external refs. */
  rels: {
    addImage(mediaFilename: string): string;
    addHyperlink(url: string): string;
  };

  /** Binary media files. Returns the filename (`"image1.png"`) for rels. */
  media: {
    add(input: { data: Uint8Array; contentType: string; ext: string }): string;
    list(): DocxMediaPart[];
  };

  /** Fidelity / unsupported-content reports. Returned in `DocxExportResult`. */
  diagnostics: {
    warn(d: Omit<DocxDiagnostic, "level">): void;
    error(d: Omit<DocxDiagnostic, "level">): void;
    list(): DocxDiagnostic[];
  };

  /**
   * Root document tree (built by the walker, written before
   * `onBuildTreeComplete` fires so lifecycle hooks can read it).
   */
  document: XmlNode;

  /**
   * Shared derived data across plugins (collaborative, not overwrite).
   * Populated in `onBeforeExport`, read in handlers.
   *
   * Conventions:
   *   "headings"  → HeadingEntry[]
   *   "footnotes" → FootnoteMap
   *   "citations" → CitationMap
   */
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
}

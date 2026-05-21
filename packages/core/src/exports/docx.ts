/**
 * Public DOCX export contract — types + a few unit helpers.
 *
 * Lives in `@scrivr/core` so both built-in extensions (which contribute
 * handlers via `addExports().docx`) and `@scrivr/export-docx` (which runs
 * the pipeline) can import the same canonical definitions. Keeping the
 * dependency direction one-way (export-docx → core) means no runtime cycle.
 *
 * `@scrivr/export-docx` re-exports these for convenience, so callers using
 * `import { DocxContext } from "@scrivr/export-docx"` still resolve.
 */

import type { Node as PmNode, Mark as PmMark } from "prosemirror-model";
import type { IBaseEditor } from "../extensions/types";

// ── XML ─────────────────────────────────────────────────────────────────────

export type XmlAttrs = Record<string, string>;

/** Minimal XML node — input to the deterministic serializer in export-docx. */
export interface XmlNode {
  name: string;
  attributes?: XmlAttrs;
  children?: Array<XmlNode | string>;
}

export type XmlChild = XmlNode | string;

/**
 * Construct an `XmlNode`. Empty `attrs`/`children` are omitted so equality
 * checks in tests stay simple.
 */
export function xml(
  name: string,
  attrs?: XmlAttrs,
  children?: XmlChild[],
): XmlNode {
  const node: XmlNode = { name };
  if (attrs && Object.keys(attrs).length > 0) node.attributes = attrs;
  if (children && children.length > 0) node.children = children;
  return node;
}

// ── Run / paragraph property bags ───────────────────────────────────────────

/**
 * The run-property bag mark handlers accumulate into and the walker emits
 * as a single `<w:r><w:rPr/>...<w:t/></w:r>`. Marks return a NEW object —
 * treat `props` as immutable.
 *
 * `trackedInsert` / `trackedDelete` are reserved here so the contract is
 * stable for a future track-changes feature PR; the base walker does NOT
 * emit `<w:ins>` / `<w:del>` wrappers yet.
 */
export interface DocxRunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Foreground color as `#RRGGBB`. Renderer strips `#` at serialize. */
  color?: string;
  /** Highlight color name per OOXML (`yellow`, `green`, ...) or `#RRGGBB`. */
  highlight?: string;
  /** Font size in pixels. Renderer converts to half-points (×1.5). */
  fontSize?: number;
  fontFamily?: string;
  /** Optional character style ID — resolved against `ctx.styles.character`. */
  styleId?: string;
  /** Reserved for the future TrackChanges DOCX feature. Not emitted yet. */
  trackedInsert?: { author: string; date: string; id: number };
  /** Reserved for the future TrackChanges DOCX feature. Not emitted yet. */
  trackedDelete?: { author: string; date: string; id: number };
}

export interface DocxStyleSpec {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  /** Space before paragraph in twips (1/20 pt). */
  spacingBefore?: number;
  /** Space after paragraph in twips. */
  spacingAfter?: number;
  /** Line height in twips (`240` = single, `276` ≈ 1.15x). */
  lineHeight?: number;
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

// ── Diagnostics ─────────────────────────────────────────────────────────────

export type DocxDiagnosticLevel = "warning" | "error";

export interface DocxDiagnostic {
  level: DocxDiagnosticLevel;
  code: string;
  message: string;
  pos?: number;
  nodeType?: string;
  markType?: string;
}

// ── Options ─────────────────────────────────────────────────────────────────

export type DocxUnsupportedPolicy = "drop" | "placeholder" | "throw";
export type DocxFidelity = "strict" | "compatible" | "best-effort";

export interface DocxResolvedOptions {
  unsupported: DocxUnsupportedPolicy;
  fidelity: DocxFidelity;
}

// ── Package ─────────────────────────────────────────────────────────────────

export interface DocxPackagePart {
  /** ZIP-relative path, e.g. `"word/document.xml"`. */
  path: string;
  contentType?: string;
  data: string | Uint8Array;
}

export interface DocxPackage {
  parts: DocxPackagePart[];
}

// ── Context ─────────────────────────────────────────────────────────────────

export interface DocxContext {
  /** The editor whose state is being exported. */
  readonly editor: IBaseEditor;
  /** Resolved export options — never undefined inside a handler. */
  readonly options: DocxResolvedOptions;

  styles: {
    paragraph: { getOrCreate(name: string, spec: DocxStyleSpec): string };
    character: { getOrCreate(name: string, spec: DocxStyleSpec): string };
    table: { getOrCreate(name: string, spec: DocxStyleSpec): string };
  };

  numbering: {
    getOrCreate(config: {
      type: "bullet" | "ordered" | "task";
      levels: DocxNumberingLevel[];
    }): { numId: number };
  };

  rels: {
    addImage(mediaFilename: string): string;
    addHyperlink(url: string): string;
  };

  media: {
    add(input: { data: Uint8Array; contentType: string; ext: string }): string;
    list(): DocxMediaPart[];
  };

  diagnostics: {
    warn(d: Omit<DocxDiagnostic, "level">): void;
    error(d: Omit<DocxDiagnostic, "level">): void;
    list(): DocxDiagnostic[];
  };

  /** Root document tree — written by the walker before `onBuildTreeComplete`. */
  document: XmlNode;

  /** Collaborative cross-plugin storage. */
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
}

// ── Handlers ────────────────────────────────────────────────────────────────

export interface DocxNodeMeta {
  inline: boolean;
}

export type DocxNodeHandler = (
  node: PmNode,
  children: XmlNode[],
  ctx: DocxContext,
  meta: DocxNodeMeta,
) => XmlNode | XmlNode[];

export type DocxMarkHandler = (
  props: DocxRunProps,
  mark: PmMark,
  ctx: DocxContext,
) => DocxRunProps;

/**
 * The handler bundle contributed by extensions for DOCX export.
 * Format packages augment `FormatHandlers.docx` to point at this.
 */
export interface DocxHandlers {
  nodes?: Record<string, DocxNodeHandler>;
  marks?: Record<string, DocxMarkHandler>;
  onBeforeExport?(ctx: DocxContext): void | Promise<void>;
  onBuildTreeComplete?(ctx: DocxContext): void | Promise<void>;
  onFinalize?(ctx: DocxContext): DocxPackage | Promise<DocxPackage>;
}

// ── Unit conversion (px → OOXML units) ──────────────────────────────────────

/** 1 inch @ 96 DPI = 96 px = 1440 twips → 15 twips per px. */
export const TWIPS_PER_PX = 15;
/** 1 inch = 914400 EMU; 1 px @ 96 DPI = 9525 EMU. */
export const EMU_PER_PX = 9525;

export function pxToTwips(px: number): number {
  return Math.round(px * TWIPS_PER_PX);
}

export function pxToEmu(px: number): number {
  return Math.round(px * EMU_PER_PX);
}

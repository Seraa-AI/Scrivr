/**
 * Public DOCX export contract — types + a few unit helpers.
 *
 * Lives in `@scrivr/core` so both built-in extensions (which contribute
 * handlers via `addExports().docx`) and `@scrivr/docx` (which runs the
 * pipeline) can import the same canonical definitions. Keeping the
 * dependency direction one-way (docx → core) means no runtime cycle.
 *
 * `@scrivr/docx` re-exports these for convenience, so callers using
 * `import { DocxContext } from "@scrivr/docx"` still resolve.
 */

import type { Node as PmNode, Mark as PmMark, Schema } from "prosemirror-model";
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

// ── OOXML color helpers ────────────────────────────────────────────────────

const OOXML_HIGHLIGHT_NAMES = [
  "black",
  "blue",
  "cyan",
  "darkBlue",
  "darkCyan",
  "darkGray",
  "darkGreen",
  "darkMagenta",
  "darkRed",
  "darkYellow",
  "green",
  "lightGray",
  "magenta",
  "none",
  "red",
  "white",
  "yellow",
] as const;

const HIGHLIGHT_BY_LOWER = new Map(
  OOXML_HIGHLIGHT_NAMES.map((name) => [name.toLowerCase(), name]),
);

/** Return a canonical OOXML highlight name, or null for arbitrary CSS colors. */
export function docxHighlightName(value: string): string | null {
  return HIGHLIGHT_BY_LOWER.get(value.trim().toLowerCase()) ?? null;
}

/** Convert common CSS color strings to DOCX's 6-char uppercase hex form. */
export function cssColorToDocxHex(value: string): string | null {
  const v = value.trim();
  const six = /^#?([0-9a-f]{6})$/i.exec(v);
  if (six?.[1]) return six[1].toUpperCase();

  const three = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (three) {
    return (
      three[1]! + three[1]! + three[2]! + three[2]! + three[3]! + three[3]!
    ).toUpperCase();
  }

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (!rgb?.[1]) return null;

  const channels = rgb[1]
    .split(",")
    .slice(0, 3)
    .map((s) => Number(s.trim()));
  if (channels.length !== 3 || channels.some((n) => !Number.isFinite(n))) {
    return null;
  }

  return channels
    .map((n) =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0")
        .toUpperCase(),
    )
    .join("");
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
  /** Foreground color as common CSS hex/rgb syntax; renderer emits DOCX hex. */
  color?: string;
  /**
   * Highlight color — must be one of OOXML's named values (`yellow`, `green`,
   * ...). For arbitrary CSS colors that don't map to a named value, use
   * `shadingFill` instead. The Highlight extension's mark handler decides
   * which to populate.
   */
  highlight?: string;
  /**
   * Arbitrary background color as a 6-char uppercase hex (no `#`). Emitted
   * as `<w:shd w:val="clear" w:color="auto" w:fill="HEX"/>`. Use when the
   * source color isn't a named OOXML highlight.
   */
  shadingFill?: string;
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

// ── Unit conversion (px ↔ OOXML units) ──────────────────────────────────────

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

export function twipsToPx(twips: number): number {
  return twips / TWIPS_PER_PX;
}

export function emuToPx(emu: number): number {
  return emu / EMU_PER_PX;
}

// ────────────────────────────────────────────────────────────────────────────
// Import side
// ────────────────────────────────────────────────────────────────────────────
//
// Mirror of the export contract for the reverse direction. The intermediate
// model (`DocxBlock` / `DocxInline` / `DocxMark`) is the normalized DOCX
// intent that sits between OOXML parsing (Stage 1, owned by `@scrivr/docx`)
// and ProseMirror JSON (Stage 2, dispatched via `addImports().docx`).
//
// Lives in core so every extension can author its parse handler against
// the same types its serializer uses. Same single-source-of-truth pattern.

// ── Intermediate model ─────────────────────────────────────────────────────

/**
 * A normalized OOXML mark. `kind` is the raw element local name with the
 * namespace prefix stripped (`<w:b/>` → `"b"`, `<w:color w:val="ff0000"/>` →
 * `"color"` with `attrs.val = "ff0000"`). Each mark extension claims its
 * `kind` and produces a `PmMarkJson` in Stage 2.
 */
export interface DocxMark {
  kind: string;
  attrs?: Record<string, unknown>;
}

export type DocxInline =
  | { type: "text"; text: string; marks: DocxMark[] }
  | { type: "hardBreak"; marks: DocxMark[] }
  | { type: "image"; src: string; width?: number; height?: number; marks: DocxMark[] };

export interface DocxParagraphAttrs {
  /** Paragraph style ID (`Heading1`, `Normal`, …) — resolved from `styles.xml`. */
  styleId?: string;
  /** From `<w:pPr><w:jc w:val="…"/>`. */
  align?: "left" | "center" | "right" | "justify";
  /** From `<w:pPr><w:numPr>` — paragraph belongs to a list. */
  numbering?: { numId: number; ilvl: number };
  /** Word's `<w:pageBreakBefore/>` hint. */
  pageBreakBefore?: boolean;
}

/**
 * A reconstructed list item. Produced by the importer's list reconstruction
 * pass — DOCX lists are flat paragraphs with `numPr` metadata; the
 * reconstruction groups them by `numId` and nests by `ilvl`. Each item's
 * content is a `DocxBlock[]` because list items can contain a paragraph
 * plus nested lists.
 */
export interface DocxListItem {
  content: DocxBlock[];
}

export type DocxBlock =
  | { type: "paragraph"; attrs: DocxParagraphAttrs; content: DocxInline[] }
  | { type: "horizontalRule" }
  | { type: "pageBreak" }
  | { type: "list"; listType: "bullet" | "ordered"; items: DocxListItem[] };

export interface DocxImportModel {
  blocks: DocxBlock[];
}

// ── Import options + context ───────────────────────────────────────────────

export type DocxMediaSink = "data-url" | "object-url" | "drop";

export interface DocxImportResolvedOptions extends DocxResolvedOptions {
  media: DocxMediaSink;
}

/**
 * Import context — readers (inverse of `DocxContext` registry writers).
 * Resolves cross-part references so handlers don't have to touch the OPC.
 * Handlers construct ProseMirror nodes against `ctx.schema`; MVP exposes
 * diagnostics + shared storage. Styles/numbering/relationships/media
 * readers fill in as the corresponding milestones land.
 */
export interface DocxImportContext {
  readonly options: DocxImportResolvedOptions;
  /** The editor's schema — handlers construct `Node` / `Mark` against this. */
  readonly schema: Schema;
  diagnostics: {
    warn(d: Omit<DocxDiagnostic, "level">): void;
    error(d: Omit<DocxDiagnostic, "level">): void;
    list(): DocxDiagnostic[];
  };
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
}

// ── Import handlers ─────────────────────────────────────────────────────────
//
// Handlers return real `Node` / `Mark` instances constructed against
// `ctx.schema`. No invented JSON shape — alignment with ProseMirror is
// load-bearing here, since serializer + parser must agree on what a node
// looks like and any drift bites in both directions.

/**
 * Stage 2 transformer for an intermediate `DocxBlock`. Receives the block,
 * its already-transformed inline children, and the context. Returns the
 * final `Node` (or `null` to drop with a diagnostic).
 */
export type DocxBlockTransform = (
  block: DocxBlock,
  content: PmNode[],
  ctx: DocxImportContext,
) => PmNode | null;

/**
 * Paragraph-style override — wins over the default `paragraph` block
 * transform when `block.attrs.styleId` matches the key. Heading extension
 * registers `paragraphStyles: { Heading1: ..., Heading2: ..., ... }`.
 */
export type DocxParagraphStyleTransform = (
  block: DocxBlock & { type: "paragraph" },
  content: PmNode[],
  ctx: DocxImportContext,
) => PmNode | null;

/**
 * Mark transformer — receives a normalized `DocxMark` (`kind` keyed on
 * the OOXML element local name) and returns a ProseMirror `Mark` or
 * `null` to drop.
 */
export type DocxMarkTransform = (
  mark: DocxMark,
  ctx: DocxImportContext,
) => PmMark | null;

/**
 * The handler bundle contributed by extensions for DOCX import. Format
 * packages augment `FormatImportHandlers.docx` to point at this.
 */
export interface DocxImports {
  /** Stage 2 block transform — dispatched by `DocxBlock.type`. */
  blocks?: Record<string, DocxBlockTransform>;
  /** Paragraph-style override — dispatched by `pStyle` value. */
  paragraphStyles?: Record<string, DocxParagraphStyleTransform>;
  /** Stage 2 mark transform — dispatched by `DocxMark.kind`. */
  marks?: Record<string, DocxMarkTransform>;

  /** Runs before Stage 1 parsing. Precompute lookup tables, etc. */
  onBeforeImport?(ctx: DocxImportContext): void | Promise<void>;
  /** Runs after Stage 2. Post-process the final doc (cross-refs, repair, …). */
  onImportComplete?(
    doc: PmNode,
    ctx: DocxImportContext,
  ): PmNode | Promise<PmNode>;
}

/**
 * DOCX handler contract — what extensions contribute via `addExports().docx`.
 *
 * Handlers are deterministic XML producers. They may request resources from
 * `DocxContext` registries (styles, numbering, rels, media), but must not
 * depend on canvas layout, mutate traversal state, or read computed line
 * fragments. The walker owns recursion and composition; handlers transform.
 *
 * Mark handlers do NOT wrap XML — they merge into a `DocxRunProps` bag that
 * the walker emits as a single `<w:r><w:rPr/>...<w:t/></w:r>`. Nested runs
 * are invalid OOXML, so the merger contract prevents the obvious failure
 * mode of `bold(italic(text(...)))`.
 */

import type { Node, Mark } from "prosemirror-model";
import type { DocxContext, XmlNode, DocxPackage } from "./context";

/** Per-call metadata passed to node handlers by the walker. */
export interface DocxNodeMeta {
  /** True when the node sits in inline content (run-level context). */
  inline: boolean;
}

/**
 * DOCX node handler.
 *
 * @param node     The ProseMirror node being transformed.
 * @param children The XML produced by the walker for the node's children,
 *                 already composed in document order. The handler decides
 *                 how to wrap or position them in its own emitted XML.
 * @param ctx      Shared export context (registries + options).
 * @param meta     `inline` flag — block nodes produce `<w:p>` / `<w:tbl>`,
 *                 inline atoms produce content meant to sit inside `<w:r>`.
 */
export type DocxNodeHandler = (
  node: Node,
  children: XmlNode[],
  ctx: DocxContext,
  meta: DocxNodeMeta,
) => XmlNode | XmlNode[];

/**
 * Run-property bag — what mark handlers contribute to and the text node
 * handler emits as one `<w:r>`. Fields are normalized Scrivr-native values
 * (px for sizes, `#RRGGBB` for colors). The renderer converts to OOXML
 * units (half-points, hex without `#`) when it emits the run.
 *
 * Extension fields (`styleId`, `trackedInsert`, `trackedDelete`) are
 * reserved here so the contract is stable, but the base walker does NOT
 * emit `<w:ins>` / `<w:del>` wrappers — track-changes XML lands in a
 * dedicated feature PR with the surrounding author/date/comment-range
 * semantics.
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

/**
 * DOCX mark handler — merges into the active run-property bag.
 *
 * Return a NEW object; treat `props` as immutable. The walker accumulates
 * marks left-to-right in ProseMirror order, then renders one `<w:r>`.
 */
export type DocxMarkHandler = (
  props: DocxRunProps,
  mark: Mark,
  ctx: DocxContext,
) => DocxRunProps;

/** Severity for fidelity / unsupported-content reports. */
export type DocxDiagnosticLevel = "warning" | "error";

/**
 * A fidelity report from the export pipeline. Returned alongside `bytes`
 * in `DocxExportResult`, or attached to a thrown `DocxExportError`.
 *
 * `code` is a stable machine identifier (e.g. `"unsupported-node"`); the
 * `message` is human-readable and may include node names / positions for
 * debug surfaces.
 */
export interface DocxDiagnostic {
  level: DocxDiagnosticLevel;
  code: string;
  message: string;
  /** Document position where the issue was detected, if known. */
  pos?: number;
  /** ProseMirror node type name, if the diagnostic is node-scoped. */
  nodeType?: string;
  /** ProseMirror mark type name, if the diagnostic is mark-scoped. */
  markType?: string;
}

/**
 * The handler bundle contributed by extensions for DOCX export.
 * Augments `FormatHandlers.docx` via module declaration in `augmentation.ts`.
 */
export interface DocxHandlers {
  /** Per-node-type handlers keyed by `node.type.name`. */
  nodes?: Record<string, DocxNodeHandler>;
  /** Per-mark-type handlers keyed by `mark.type.name`. */
  marks?: Record<string, DocxMarkHandler>;

  /** Runs before tree construction. Precompute TOC, numbering, bookmarks. */
  onBeforeExport?(ctx: DocxContext): void | Promise<void>;
  /** Runs after tree is built but before packaging. Bookmarks, cross-refs. */
  onBuildTreeComplete?(ctx: DocxContext): void | Promise<void>;
  /** Custom packaging (optional). If omitted, default packager is used. */
  onFinalize?(ctx: DocxContext): DocxPackage | Promise<DocxPackage>;
}

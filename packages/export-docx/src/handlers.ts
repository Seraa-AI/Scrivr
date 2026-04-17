/**
 * DOCX handler types. Extensions contribute these via addExports().
 *
 * Handlers are pure tree producers: (node, ctx, meta) → XmlNode[].
 * No side effects, no global cursor, no layout dependency.
 * The walker composes child results into parent nodes.
 */

import type { Node, Mark } from "prosemirror-model";
import type { DocxContext, XmlNode, DocxPackage } from "./context";

/**
 * DOCX node handler. Returns XML nodes (or fragments).
 * `meta.inline` determines structural context — block nodes produce
 * `<w:p>` wrappers, inline atoms produce `<w:r>` content.
 */
export type DocxNodeHandler = (
  node: Node,
  ctx: DocxContext,
  meta: { inline: boolean },
) => XmlNode | XmlNode[];

/**
 * DOCX mark handler. Wraps inline content (runs) with mark-specific
 * formatting — bold, italic, highlight, tracked changes, etc.
 */
export type DocxMarkHandler = (
  content: XmlNode[],
  mark: Mark,
  ctx: DocxContext,
) => XmlNode[];

/**
 * The handler bundle contributed by extensions for DOCX export.
 * Augments `FormatHandlers.docx` via module declaration.
 */
export interface DocxHandlers {
  /** Per-node-type handlers keyed by node.type.name. */
  nodes?: Record<string, DocxNodeHandler>;
  /** Per-mark-type handlers keyed by mark.type.name. */
  marks?: Record<string, DocxMarkHandler>;

  /** Runs before tree construction. Precompute TOC, numbering, bookmarks. */
  onBeforeExport?(ctx: DocxContext): void | Promise<void>;
  /** Runs after tree is built but before packaging. Bookmarks, cross-refs. */
  onBuildTreeComplete?(ctx: DocxContext): void | Promise<void>;
  /** Custom packaging (optional). If omitted, default packager is used. */
  onFinalize?(ctx: DocxContext): DocxPackage | Promise<DocxPackage>;
}

/**
 * Module augmentation — declares the "markdown" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-markdown.
 *
 * Handler types use structural interfaces rather than importing prosemirror-model
 * directly — avoids a build-time type resolution issue in the DTS rollup.
 */

/** Serialize a PM node to markdown. Receives the already-serialized children. */
export type MarkdownNodeHandler = (
  node: { type: { name: string }; attrs: Record<string, unknown>; text?: string | null },
  children: string,
) => string;

/** Wrap already-marked text content with markdown syntax. */
export type MarkdownMarkHandler = (
  content: string,
  mark: { type: { name: string }; attrs: Record<string, unknown> },
) => string;

export interface MarkdownHandlers {
  /** Per-node serializer, keyed by node.type.name. */
  nodes?: Record<string, MarkdownNodeHandler>;
  /** Per-mark wrapper, keyed by mark.type.name. */
  marks?: Record<string, MarkdownMarkHandler>;
}

declare module "@scrivr/core" {
  interface FormatHandlers {
    markdown: MarkdownHandlers;
  }
}

/**
 * Module augmentation — declares the "markdown" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-markdown.
 */

/** Placeholder — filled in during M2 export dispatch refactor. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MarkdownHandlers {}

declare module "@scrivr/core" {
  interface FormatHandlers {
    markdown: MarkdownHandlers;
  }
}

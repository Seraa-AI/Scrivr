/**
 * Module augmentation — declares the "pdf" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-pdf.
 *
 * When this package is loaded, `ExportContribution` includes
 * `{ format: "pdf"; handlers: PdfHandlers }` so extensions can declare
 * PDF-specific export contributions via `addExports()`.
 *
 * The actual PdfHandlers shape is a placeholder until M2 (export dispatch
 * refactor) lands — at that point it will carry per-node-type draw
 * functions, font resolvers, etc.
 */

/** Placeholder — filled in during M2 export dispatch refactor. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PdfHandlers {}

declare module "@scrivr/core" {
  interface FormatHandlers {
    pdf: PdfHandlers;
  }
}

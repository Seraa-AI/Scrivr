/**
 * Module augmentation — declares the "docx" format key on both
 * `FormatHandlers` (export) and `FormatImportHandlers` (import). Imported
 * for its side-effect at the entry point of `@scrivr/docx`.
 *
 * When this package is loaded, `ExportContributionMap` includes the "docx"
 * key (and so does `ImportContributionMap`) so extensions can declare
 * DOCX-specific contributions in either direction.
 */

import type { DocxHandlers, DocxImports } from "@scrivr/core";

declare module "@scrivr/core" {
  interface FormatHandlers {
    docx: DocxHandlers;
  }
  interface FormatImportHandlers {
    docx: DocxImports;
  }
}

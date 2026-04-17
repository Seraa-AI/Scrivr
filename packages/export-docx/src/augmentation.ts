/**
 * Module augmentation — declares the "docx" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-docx.
 *
 * When this package is loaded, `ExportContributionMap` includes the "docx"
 * key so extensions can declare DOCX-specific export contributions.
 */

import type { DocxHandlers } from "./handlers";

declare module "@scrivr/core" {
  interface FormatHandlers {
    docx: DocxHandlers;
  }
}

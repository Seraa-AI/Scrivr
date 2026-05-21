/**
 * DOCX handler contract — re-exported from `@scrivr/core`.
 *
 * The canonical type definitions live in `@scrivr/core/exports/docx` so
 * built-in extensions can contribute via `addExports().docx` without a
 * runtime dependency on this package. This file is a thin re-export so
 * existing consumers using `import { DocxHandlers } from "@scrivr/export-docx"`
 * still resolve to the same types.
 */

export type {
  DocxNodeMeta,
  DocxNodeHandler,
  DocxRunProps,
  DocxMarkHandler,
  DocxDiagnosticLevel,
  DocxDiagnostic,
  DocxHandlers,
} from "@scrivr/core";

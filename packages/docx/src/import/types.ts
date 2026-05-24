/**
 * Re-export the canonical intermediate-model types from `@scrivr/core`.
 *
 * The model lives in core so every extension can author its import
 * handlers against the same shapes. This file exists so existing callers
 * using `import { DocxBlock } from "@scrivr/docx"` keep working.
 */

export type {
  DocxMark,
  DocxInline,
  DocxBlock,
  DocxParagraphAttrs,
  DocxImportModel,
} from "@scrivr/core";

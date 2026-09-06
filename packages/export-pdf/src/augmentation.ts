/**
 * Module augmentation — declares the "pdf" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-pdf.
 */

import type { LayoutBlock, LayoutPage } from "@scrivr/core";
import type { PDFFont } from "pdf-lib";
import type { PdfContext } from "./context";
import type { PdfMarkStyler } from "@scrivr/core";

/** Draw a block (or inline atom) onto a PDF page. */
export type PdfNodeHandler = (block: LayoutBlock, ctx: PdfContext) => void;

export type PdfChromeHandler<P = unknown> = (
  layoutPage: LayoutPage,
  payload: P,
  ctx: PdfContext,
) => void;

export interface PdfHandlers {
  /** Per-block drawing + inline atom dispatch table, keyed by node.type.name. */
  nodes?: Record<string, PdfNodeHandler>;
  /**
   * Per-mark inline styling, keyed by mark.type.name. A styler returns what
   * the mark contributes; the painter owns every baseline and width.
   */
  marks?: Record<string, PdfMarkStyler>;
  /** Per-page chrome, keyed by chrome contributor name. */
  chrome?: Record<string, PdfChromeHandler<unknown>>;
  /** Runs once before page iteration. Async allowed. */
  onBeforeExport?(ctx: PdfContext): void | Promise<void>;
  /** Runs once after all pages are drawn, before save. */
  onAfterExport?(ctx: PdfContext): void | Promise<void>;
}

declare module "@scrivr/core" {
  interface FormatHandlers {
    pdf: PdfHandlers;
  }
}

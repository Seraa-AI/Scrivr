/**
 * Module augmentation — declares the "pdf" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-pdf.
 */

import type {
  LayoutBlock,
  LayoutPage,
  PdfMarkHandler,
  PdfNodeContext,
  PdfNodeHandler,
} from "@scrivr/core";
import type { PdfContext } from "./context";

/** Declared by core, so an extension types its handler without depending here. */
export type { PdfNodeHandler } from "@scrivr/core";

/**
 * Draw chrome (headers, footers, footnote bands) onto a PDF page.
 * Generic parameter P is the plugin-specific payload type.
 */
export type PdfChromeHandler<P = unknown> = (
  layoutPage: LayoutPage,
  payload: P,
  ctx: PdfNodeContext,
) => void;

export interface PdfHandlers {
  /** Per-block drawing + inline atom dispatch table, keyed by node.type.name. */
  nodes?: Record<string, PdfNodeHandler>;
  /** Per-mark inline styling, keyed by mark.type.name. */
  marks?: Record<string, PdfMarkHandler>;
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

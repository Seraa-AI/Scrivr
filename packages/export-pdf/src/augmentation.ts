/**
 * Module augmentation — declares the "pdf" format key on FormatHandlers.
 * Imported for its side-effect at the entry point of @scrivr/export-pdf.
 */

import type { LayoutBlock, LayoutPage } from "@scrivr/core";
import type { PDFFont } from "pdf-lib";
import type { PdfContext } from "./context";

/**
 * What a mark does to the span it covers. Colours are CSS strings — the same
 * spelling the canvas uses — so an extension can describe its mark without
 * depending on pdf-lib or on how a colour is composited for print.
 *
 * A handler says what a mark means, never where the ink goes: thickness and
 * offsets stay with the renderer, so every mark's underline sits on the same
 * line.
 */
export interface PdfSpanStyle {
  /** A colour the author chose. Beats any `defaultColor` on the same span. */
  color?: string;
  /**
   * The colour this mark gives a span for being what it is — a link's blue.
   * Loses to an authored `color`, whatever order the marks arrive in.
   */
  defaultColor?: string;
  underline?: boolean;
  /** Underline in this colour instead of following the text. */
  underlineColor?: string;
  strikethrough?: boolean;
  /** Painted over the text, as a highlighter would be. */
  backgroundColor?: { color: string; opacity?: number };
  font?: PDFFont;
}

/** Draw a block (or inline atom) onto a PDF page. */
export type PdfNodeHandler = (block: LayoutBlock, ctx: PdfContext) => void;

/** What this mark does to a span. Called once per mark, per span. */
export type PdfMarkHandler = (
  mark: { name: string; attrs: Record<string, unknown> },
  ctx: PdfContext,
) => PdfSpanStyle;

/**
 * Draw chrome (headers, footers, footnote bands) onto a PDF page.
 * Generic parameter P is the plugin-specific payload type.
 */
export type PdfChromeHandler<P = unknown> = (
  layoutPage: LayoutPage,
  payload: P,
  ctx: PdfContext,
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

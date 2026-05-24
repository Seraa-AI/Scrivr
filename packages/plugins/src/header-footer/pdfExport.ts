/**
 * PDF export handler for header/footer chrome bands. Pure render —
 * no layout decisions made here.
 *
 * Draws headers and footers onto each PDF page using the pre-computed
 * mini-layouts that `resolveChrome` produced during the editor's
 * layout pass. Block positions are offset from the stored
 * `margins.top` to the actual band Y on the PDF page; no re-measure.
 *
 * The editing-gap reservation (`HeaderFooter.configure({
 * activeEditingGap })`) is applied once at layout time inside
 * `measureSlot` and lives in `slot.reservedHeight` + the layout's
 * `metrics.contentTop`. This file reads those values verbatim — it
 * has no knob of its own to change the gap. To change it for PDF
 * output you change the extension option at editor construction and
 * re-layout (e.g. by running the PDF export against a separate
 * `ServerEditor` configured with the desired gap, sharing the same
 * doc JSON).
 */

import type { LayoutBlock } from "@scrivr/core";
import type { ResolvedHeaderFooter } from "./resolveChrome";
import { resolveSlotKey } from "./resolveSlot";
import { setTokenContext, getCurrentPageNumber, getCurrentTotalPages } from "./tokenStrategies";

/** Minimal shape of the PDF context — avoids importing from @scrivr/export-pdf. */
interface PdfContextLike {
  layout: {
    pages: Array<{ pageNumber: number }>;
    pageConfig: { pageHeight: number; margins: { top: number; bottom: number } };
    metrics?: Array<{ headerTop: number; headerHeight: number; footerTop: number; footerHeight: number }>;
  };
  page: { drawText(text: string, opts: { x: number; y: number; size: number; font: unknown; color: unknown }): void };
  fonts: { resolve(cssFont: string): unknown; fallback: unknown };
  draw: {
    lines(
      block: { x: number; y: number; width: number; availableWidth: number; lines: unknown[]; [k: string]: unknown },
      ctx: unknown,
    ): void;
  };
  x: number;
  y: number;
  width: number;
}

function isResolvedPayload(value: unknown): value is ResolvedHeaderFooter {
  if (typeof value !== "object" || value === null) return false;
  return "policy" in value && "slots" in value;
}

function isPdfContext(value: unknown): value is PdfContextLike {
  if (typeof value !== "object" || value === null) return false;
  return "layout" in value && "draw" in value;
}

/**
 * PDF chrome handler for headerFooter. Called once per page by the export
 * pipeline's chrome dispatch loop.
 */
export function renderHeaderFooterPdf(
  layoutPage: { pageNumber: number },
  payload: unknown,
  ctx: unknown,
): void {
  if (!isResolvedPayload(payload)) return;
  if (!isPdfContext(ctx)) return;
  const pdfCtx = ctx;
  const pageNumber = layoutPage.pageNumber;
  const metrics = pdfCtx.layout.metrics?.[pageNumber - 1];
  if (!metrics) return;

  setTokenContext(pageNumber, pdfCtx.layout.pages.length);

  renderBand(payload, pageNumber, "header", metrics.headerTop, pdfCtx);
  renderBand(payload, pageNumber, "footer", metrics.footerTop, pdfCtx);
}

function renderBand(
  resolved: ResolvedHeaderFooter,
  pageNumber: number,
  kind: "header" | "footer",
  bandY: number,
  pdfCtx: PdfContextLike,
): void {
  const slotKey = resolveSlotKey(resolved.policy, pageNumber, kind);
  if (!slotKey) return;

  const slot = resolved.slots[slotKey];
  if (!slot) return;

  const page = slot.layout.pages[0];
  if (!page || page.blocks.length === 0) return;

  // The stored layout has blocks at margins.top (from runMiniPipeline).
  // Offset to the actual band Y on the page.
  const offsetY = bandY - slot.layout.pageConfig.margins.top;

  for (const block of page.blocks) {
    // Create an offset copy — don't mutate the stored block
    const offsetBlock = { ...block, y: block.y + offsetY };
    pdfCtx.x = offsetBlock.x;
    pdfCtx.y = offsetBlock.y;
    pdfCtx.width = offsetBlock.width;
    pdfCtx.draw.lines(offsetBlock, pdfCtx);
  }
}

// ── PDF node handlers for token inline atoms ─────────────────────────────────

const PT_PER_PX = 72 / 96;

function flipY(yPx: number, pageHeightPt: number): number {
  return pageHeightPt - yPx * PT_PER_PX;
}

function drawTokenOnPdf(text: string, block: LayoutBlock, ctx: PdfContextLike): void {
  const pageHeightPt = ctx.layout.pageConfig.pageHeight * PT_PER_PX;
  const font = ctx.fonts.fallback;
  const size = 10 * PT_PER_PX;
  ctx.page.drawText(text, {
    x: block.x * PT_PER_PX,
    y: flipY(block.y + block.height, pageHeightPt),
    size,
    font,
    // Structural match for pdf-lib's RGB color without importing the library
    color: { type: "RGB", red: 0.61, green: 0.64, blue: 0.69 },
  });
}

/** PDF node handler for pageNumber token. */
export function renderPageNumberPdf(block: LayoutBlock, ctx: unknown): void {
  if (!isPdfContext(ctx)) return;
  drawTokenOnPdf(String(getCurrentPageNumber()), block, ctx);
}

/** PDF node handler for totalPages token. */
export function renderTotalPagesPdf(block: LayoutBlock, ctx: unknown): void {
  if (!isPdfContext(ctx)) return;
  drawTokenOnPdf(String(getCurrentTotalPages()), block, ctx);
}

/** PDF node handler for date token. */
export function renderDatePdf(block: LayoutBlock, ctx: unknown): void {
  if (!isPdfContext(ctx)) return;
  const frozen = block.node.attrs["frozen"];
  const parsed = typeof frozen === "string" ? new Date(frozen) : new Date();
  const now = isNaN(parsed.getTime()) ? new Date() : parsed;
  drawTokenOnPdf(now.toLocaleDateString(), block, ctx);
}

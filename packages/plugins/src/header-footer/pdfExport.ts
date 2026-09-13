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

import type { LayoutBlock, PdfDrawSurface } from "@scrivr/core";
import type { ResolvedHeaderFooter } from "./resolveChrome";
import { resolveSlotKey } from "./resolveSlot";
import { setTokenContext, getCurrentPageNumber, getCurrentTotalPages } from "./tokenStrategies";

/** What these handlers need of the context the export pipeline hands them. */
interface PdfContextLike {
  layout: {
    pages: Array<{ pageNumber: number }>;
    pageConfig: { pageHeight: number; margins: { top: number; bottom: number } };
    metrics?: Array<{ headerTop: number; headerHeight: number; footerTop: number; footerHeight: number }>;
  };
  draw: PdfDrawSurface & {
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

/** #9ca3af — the same grey the table borders use. */
const TOKEN_COLOR = { r: 156, g: 163, b: 175 };

function drawTokenOnPdf(text: string, block: LayoutBlock, ctx: PdfContextLike): void {
  ctx.draw.text({
    text,
    x: block.x,
    baselineY: block.y + block.height,
    sizePx: 10,
    // No family named, so the exporter resolves its standard fallback — which
    // is what this drew before, by asking for the fallback directly.
    font: { cssFont: "10px sans-serif" },
    color: TOKEN_COLOR,
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

/**
 * PDF export handler for header/footer chrome bands. Pure render —
 * no layout decisions made here.
 *
 * Places the pre-computed mini-layouts that `resolveChrome` produced during
 * the editor's layout pass, then hands their blocks to the pipeline's dispatch
 * so each is drawn by the extension that owns it. Block positions are offset
 * from the stored `margins.top` to the actual band Y on the page; no
 * re-measure, and nothing painted here.
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

import type { LayoutBlock, PdfNodeContext, Rgb } from "@scrivr/core";
import { fontSizeOf } from "@scrivr/core";
import type { ResolvedHeaderFooter } from "./resolveChrome";
import { resolveSlotKey } from "./resolveSlot";
import { setTokenContext, getCurrentPageNumber, getCurrentTotalPages } from "./tokenStrategies";

/** The band reads the layout and dispatches; it never draws anything itself. */
type BandContext = Pick<PdfNodeContext, "layout" | "blocks">;

/** A token paints one string and nothing else. */
type TokenContext = Pick<PdfNodeContext, "draw" | "font">;

function isResolvedPayload(value: unknown): value is ResolvedHeaderFooter {
  if (typeof value !== "object" || value === null) return false;
  return "policy" in value && "slots" in value;
}

/**
 * PDF chrome handler for headerFooter. Called once per page by the export
 * pipeline's chrome dispatch loop.
 */
export function renderHeaderFooterPdf(
  layoutPage: { pageNumber: number },
  payload: unknown,
  pdfCtx: BandContext,
): void {
  if (!isResolvedPayload(payload)) return;
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
  pdfCtx: BandContext,
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

  // Offset copies — the stored blocks are not mutated.
  const banded = page.blocks.map((block) => ({ ...block, y: block.y + offsetY }));

  pdfCtx.blocks(banded);
}

// ── PDF node handlers for token inline atoms ─────────────────────────────────

/** #9ca3af — the same grey the table borders use. */
const TOKEN_COLOR: Rgb = { r: 156, g: 163, b: 175 };
const TOKEN_SIZE_PX = 10;

function drawTokenOnPdf(
  text: string,
  block: LayoutBlock,
  ctx: TokenContext,
): void {
  // The face the layout measured this token against, which is the one the
  // canvas paints it in. Naming a family here instead would size the token's
  // box from one typeface and draw it in another.
  const font = ctx.font ?? { cssFont: `${TOKEN_SIZE_PX}px sans-serif` };
  ctx.draw.text({
    text,
    x: block.x,
    baselineY: block.y + block.height,
    sizePx: fontSizeOf(font.cssFont),
    font,
    color: TOKEN_COLOR,
  });
}


/** PDF node handler for pageNumber token. */
export function renderPageNumberPdf(block: LayoutBlock, ctx: TokenContext): void {
  drawTokenOnPdf(String(getCurrentPageNumber()), block, ctx);
}

/** PDF node handler for totalPages token. */
export function renderTotalPagesPdf(block: LayoutBlock, ctx: TokenContext): void {
  drawTokenOnPdf(String(getCurrentTotalPages()), block, ctx);
}

/** PDF node handler for date token. */
export function renderDatePdf(block: LayoutBlock, ctx: TokenContext): void {
  const frozen = block.node.attrs["frozen"];
  const parsed = typeof frozen === "string" ? new Date(frozen) : new Date();
  const now = isNaN(parsed.getTime()) ? new Date() : parsed;
  drawTokenOnPdf(now.toLocaleDateString(), block, ctx);
}

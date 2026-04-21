/**
 * PDF export handler for header/footer chrome bands.
 *
 * Draws headers and footers onto each PDF page using the pre-computed
 * mini-layouts from resolveChrome. No re-layout needed — block positions
 * are offset from the stored margins.top to the actual band Y position.
 */

import type { ResolvedHeaderFooter } from "./resolveChrome";
import type { SlotKey } from "./surfaces";
import { resolveSlot } from "./resolveSlot";
import { setTokenContext } from "./tokenStrategies";

/** Minimal shape of the PDF context — avoids importing from @scrivr/export-pdf. */
interface PdfContextLike {
  layout: {
    pages: Array<{ pageNumber: number }>;
    pageConfig: { margins: { top: number; bottom: number } };
    metrics?: Array<{ headerTop: number; headerHeight: number; footerTop: number; footerHeight: number }>;
  };
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

function resolveSlotKey(
  resolved: ResolvedHeaderFooter,
  pageNumber: number,
  kind: "header" | "footer",
): SlotKey | null {
  const def = resolveSlot(resolved.policy, { pageNumber }, kind);
  if (!def) return null;
  if (kind === "header") {
    return def === resolved.policy.firstPageHeader ? "firstPageHeader" : "defaultHeader";
  }
  return def === resolved.policy.firstPageFooter ? "firstPageFooter" : "defaultFooter";
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
  const slotKey = resolveSlotKey(resolved, pageNumber, kind);
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

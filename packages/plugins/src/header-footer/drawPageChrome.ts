/**
 * drawPageChrome — paints header and footer bands onto the canvas.
 *
 * Each band runs its own mini-layout with margins.top set to the band's
 * actual Y position on the page. This produces blocks at the correct
 * page-space coordinates — same coordinate system as the body, so
 * drawBlock, charMap, coordsAtPos, and posAtCoords all work identically.
 */

import {
  drawBlock,
  runMiniPipeline,
  CharacterMap,
  defaultFontConfig,
  type EditorSurface,
  type DocumentLayout,
  type PageChromePaintContext,
  type FontConfig,
} from "@scrivr/core";
import type { Node } from "prosemirror-model";
import type { ResolvedHeaderFooter, SlotLayout } from "./resolveChrome";
import type { SlotKey } from "./surfaces";
import { HeaderFooterSurfaceCache } from "./surfaces";
import { resolveSlot } from "./resolveSlot";

export interface DrawChromeOptions {
  ctx: PageChromePaintContext;
  resolved: ResolvedHeaderFooter;
  activeSurface: EditorSurface | null;
  /** The page where the user activated editing. Only this page shows live content. */
  activePage: number;
}

export function drawPageChrome(options: DrawChromeOptions): void {
  const { ctx, resolved, activeSurface, activePage } = options;
  // All pages show live edits when a surface is active. Only the active
  // page populates the charMap (for cursor placement + click positioning).
  drawBandIfPresent(ctx, resolved, "header", activeSurface, ctx.pageNumber === activePage);
  drawBandIfPresent(ctx, resolved, "footer", activeSurface, ctx.pageNumber === activePage);
}

function drawBandIfPresent(
  paintCtx: PageChromePaintContext,
  resolved: ResolvedHeaderFooter,
  kind: "header" | "footer",
  activeSurface: EditorSurface | null,
  isCursorPage: boolean,
): void {
  const bandHeight = kind === "header"
    ? paintCtx.metrics.headerHeight
    : paintCtx.metrics.footerHeight;
  if (bandHeight <= 0) return;

  const slotKey = resolveSlotKey(resolved, paintCtx.pageNumber, kind);
  if (!slotKey) return;

  const slot = resolved.slots[slotKey];
  if (!slot) return;

  const bandY = kind === "header"
    ? paintCtx.metrics.headerTop
    : paintCtx.metrics.footerTop;

  const isLive = activeSurface !== null
    && HeaderFooterSurfaceCache.slotKeyFromId(activeSurface.id) === slotKey;

  const doc = isLive ? activeSurface!.state.doc : slot.doc;

  // All pages show live content when editing. Only the cursor page populates
  // the surface charMap (for cursor placement and click-to-position).
  // Other pages use a throwaway charMap.
  const charMap = isLive && isCursorPage ? activeSurface!.charMap : new CharacterMap();
  if (isLive && isCursorPage) charMap.clear();

  const layout = layoutAtBandY(doc, paintCtx, bandY);
  const page = layout.pages[0];
  if (!page || page.blocks.length === 0) return;

  drawBlocks(paintCtx, layout, charMap);

  if (isLive) {
    drawActiveBandHighlight(paintCtx, kind);
  }

  drawSeparator(paintCtx, kind, bandY, bandHeight);
}

/** Font config for chrome bands — no space between paragraphs. */
const chromeFontConfig: FontConfig = {
  ...defaultFontConfig,
  paragraph: { ...defaultFontConfig.paragraph, spaceBefore: 0, spaceAfter: 0 },
};

/** Run mini-layout with margins.top = bandY so blocks land at the correct page Y. */
function layoutAtBandY(
  doc: Node,
  paintCtx: PageChromePaintContext,
  bandY: number,
): DocumentLayout {
  return runMiniPipeline(doc, {
    pageConfig: {
      ...paintCtx.pageConfig,
      margins: { ...paintCtx.pageConfig.margins, top: bandY },
    },
    measurer: paintCtx.measurer,
    fontConfig: chromeFontConfig,
  });
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

function drawSeparator(
  paintCtx: PageChromePaintContext,
  kind: "header" | "footer",
  bandY: number,
  bandHeight: number,
): void {
  const { ctx, pageConfig } = paintCtx;
  const { margins } = pageConfig;

  const lineY = kind === "header" ? bandY + bandHeight : bandY;

  ctx.save();
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(margins.left, lineY);
  ctx.lineTo(pageConfig.pageWidth - margins.right, lineY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawActiveBandHighlight(
  paintCtx: PageChromePaintContext,
  kind: "header" | "footer",
): void {
  const { ctx, pageConfig, metrics } = paintCtx;
  const { margins } = pageConfig;
  const bandY = kind === "header" ? metrics.headerTop : metrics.footerTop;
  const bandHeight = kind === "header" ? metrics.headerHeight : metrics.footerHeight;

  ctx.save();
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    margins.left,
    bandY,
    pageConfig.pageWidth - margins.left - margins.right,
    bandHeight,
  );
  ctx.restore();
}

/** Draw all blocks. Same drawBlock as the body uses — no transforms. */
function drawBlocks(
  paintCtx: PageChromePaintContext,
  layout: DocumentLayout,
  charMap: CharacterMap,
): void {
  const { ctx, measurer, markDecorators, pageNumber } = paintCtx;
  const page = layout.pages[0];
  if (!page) return;

  let lineIndexOffset = 0;
  for (const block of page.blocks) {
    lineIndexOffset = drawBlock(
      ctx, block, measurer, charMap,
      pageNumber, lineIndexOffset, markDecorators,
    );
  }
}

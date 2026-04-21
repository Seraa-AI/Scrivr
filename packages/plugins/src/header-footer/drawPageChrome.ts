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
import { setTokenContext } from "./tokenStrategies";

/** Reusable throwaway CharacterMap for non-cursor pages. Avoids allocating on every paint. */
const THROWAWAY_CHARMAP = new CharacterMap();

export interface DrawChromeOptions {
  ctx: PageChromePaintContext;
  resolved: ResolvedHeaderFooter;
  activeSurface: EditorSurface | null;
  /** The page where the user activated editing. Only this page shows live content. */
  activePage: number;
}

export function drawPageChrome(options: DrawChromeOptions): void {
  const { ctx, resolved, activeSurface, activePage } = options;

  // Set page context so token strategies render actual values (page number, total pages)
  setTokenContext(ctx.pageNumber, ctx.totalPages);

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

  if (isLive) {
    // Live editing: re-layout from the surface's current doc
    const charMap = isCursorPage ? activeSurface!.charMap : THROWAWAY_CHARMAP;
    charMap.clear();
    const layout = layoutAtBandY(activeSurface!.state.doc, paintCtx, bandY);
    const page = layout.pages[0];
    if (!page || page.blocks.length === 0) return;
    drawBlocks(paintCtx, layout, charMap);
  } else {
    // Stored path: reuse the pre-computed layout, offset Y to the band position.
    // No runMiniPipeline call — the layout was already computed during measure().
    const storedPage = slot.layout.pages[0];
    if (!storedPage || storedPage.blocks.length === 0) return;
    const offsetY = bandY - slot.layout.pageConfig.margins.top;
    drawBlocksWithOffset(paintCtx, storedPage.blocks, offsetY);
  }
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

/**
 * Draw stored blocks with a Y offset applied via canvas translate.
 * Uses a throwaway charMap since stored content isn't interactively editable.
 */
function drawBlocksWithOffset(
  paintCtx: PageChromePaintContext,
  blocks: DocumentLayout["pages"][0]["blocks"],
  offsetY: number,
): void {
  const { ctx, measurer, markDecorators, blockRegistry, inlineRegistry, pageNumber } = paintCtx;

  ctx.save();
  ctx.translate(0, offsetY);

  let lineIndexOffset = 0;
  for (const block of blocks) {
    const strategy = blockRegistry?.get(block.blockType);
    if (strategy) {
      lineIndexOffset = strategy.render(
        block,
        {
          ctx,
          pageNumber,
          lineIndexOffset,
          dpr: 1,
          measurer,
          ...(markDecorators ? { markDecorators } : {}),
          ...(inlineRegistry ? { inlineRegistry } : {}),
        },
        THROWAWAY_CHARMAP,
      );
    } else {
      lineIndexOffset = drawBlock(
        ctx, block, measurer, THROWAWAY_CHARMAP,
        pageNumber, lineIndexOffset, markDecorators,
      );
    }
  }

  ctx.restore();
}

/** Draw all blocks using the same rendering path as the body. */
function drawBlocks(
  paintCtx: PageChromePaintContext,
  layout: DocumentLayout,
  charMap: CharacterMap,
): void {
  const { ctx, measurer, markDecorators, blockRegistry, inlineRegistry, pageNumber } = paintCtx;
  const page = layout.pages[0];
  if (!page) return;

  let lineIndexOffset = 0;
  for (const block of page.blocks) {
    // Use block strategy when available — handles inline images, custom nodes.
    // Falls back to raw drawBlock for basic text rendering.
    const strategy = blockRegistry?.get(block.blockType);
    if (strategy) {
      lineIndexOffset = strategy.render(
        block,
        {
          ctx,
          pageNumber,
          lineIndexOffset,
          dpr: 1,
          measurer,
          ...(markDecorators ? { markDecorators } : {}),
          ...(inlineRegistry ? { inlineRegistry } : {}),
        },
        charMap,
      );
    } else {
      lineIndexOffset = drawBlock(
        ctx, block, measurer, charMap,
        pageNumber, lineIndexOffset, markDecorators,
      );
    }
  }
}

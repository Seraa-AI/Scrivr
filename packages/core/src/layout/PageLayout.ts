import { Node } from "prosemirror-model";
import { TextMeasurer } from "./TextMeasurer";
import { FontConfig, defaultFontConfig, getBlockStyle } from "./FontConfig";
import { layoutBlock, LayoutBlock } from "./BlockLayout";

export interface PageConfig {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

export interface LayoutPage {
  pageNumber: number;
  blocks: LayoutBlock[];
}

export interface DocumentLayout {
  pages: LayoutPage[];
  pageConfig: PageConfig;
  /**
   * Increments on every layout run. PageRenderer checks this before drawing
   * to abort stale renders when the document changes mid-scroll.
   */
  version: number;
}

export interface PageLayoutOptions {
  pageConfig: PageConfig;
  measurer: TextMeasurer;
  fontConfig?: FontConfig;
  /**
   * Pass the previous version so callers can increment it.
   * Defaults to 1 on first layout.
   */
  previousVersion?: number;
}

/** A4 at 96dpi with 1-inch margins */
export const defaultPageConfig: PageConfig = {
  pageWidth: 794,
  pageHeight: 1123,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};

/**
 * layoutDocument — the top-level layout pass.
 *
 * Walks every block node in the ProseMirror doc, stacks them vertically,
 * detects page boundaries, and returns a fully positioned DocumentLayout.
 *
 * Does NOT touch the CharacterMap — that is the PageRenderer's responsibility.
 * This keeps layout pure: same inputs always produce the same output.
 *
 * Y coordinates in LayoutBlock are PAGE-LOCAL (0 = page top edge).
 * Each page's canvas starts at (0,0), so renderers use these directly.
 */
export function layoutDocument(
  doc: Node,
  options: PageLayoutOptions
): DocumentLayout {
  const { pageConfig, measurer } = options;
  const fontConfig = options.fontConfig ?? defaultFontConfig;
  const version = (options.previousVersion ?? 0) + 1;

  const { pageWidth, pageHeight, margins } = pageConfig;
  const contentWidth = pageWidth - margins.left - margins.right;
  const contentHeight = pageHeight - margins.top - margins.bottom;

  const pages: LayoutPage[] = [];
  let currentPage: LayoutPage = { pageNumber: 1, blocks: [] };
  let y = margins.top;
  let prevSpaceAfter = 0;

  doc.forEach((node, offset) => {
    // ── Hard page break ──────────────────────────────────────────────────────
    if (node.type.name === "page_break") {
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = margins.top;
      prevSpaceAfter = 0;
      return;
    }

    // ── Margin collapsing ────────────────────────────────────────────────────
    const level = node.attrs["level"] as number | undefined;
    const blockStyle = getBlockStyle(fontConfig, node.type.name, level);
    const isFirstOnPage = currentPage.blocks.length === 0;
    const gap = isFirstOnPage
      ? 0
      : collapseMargins(prevSpaceAfter, blockStyle.spaceBefore);

    const targetY = y + gap;

    // ── Measure block (no CharacterMap — just dimensions) ────────────────────
    const block = layoutBlock(node, {
      nodePos: offset,
      x: margins.left,
      y: targetY,
      availableWidth: contentWidth,
      page: currentPage.pageNumber,
      measurer,
      fontConfig,
      // map intentionally omitted — PageRenderer populates it
    });

    // ── Page overflow check ───────────────────────────────────────────────────
    const blockBottom = targetY + block.height;
    const pageBottom = margins.top + contentHeight;
    const overflows = blockBottom > pageBottom && !isFirstOnPage;

    // A block taller than a full page must still be placed — never skip.
    const tooTallForAnyPage = block.height > contentHeight;

    if (overflows && !tooTallForAnyPage) {
      // ── Move to next page ──────────────────────────────────────────────────
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = margins.top;
      prevSpaceAfter = 0;

      // Re-layout at the top of the new page
      const reflow = layoutBlock(node, {
        nodePos: offset,
        x: margins.left,
        y: margins.top,
        availableWidth: contentWidth,
        page: currentPage.pageNumber,
        measurer,
        fontConfig,
      });

      currentPage.blocks.push(reflow);
      y = margins.top + reflow.height;
      prevSpaceAfter = reflow.spaceAfter;
    } else {
      // ── Place on current page ──────────────────────────────────────────────
      currentPage.blocks.push(block);
      y = targetY + block.height;
      prevSpaceAfter = block.spaceAfter;
    }
  });

  // Flush last page (always — even if empty, so there's at least one page)
  pages.push(currentPage);

  return { pages, pageConfig, version };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newPage(pageNumber: number): LayoutPage {
  return { pageNumber, blocks: [] };
}

/**
 * CSS-style margin collapsing.
 * The gap between two adjacent blocks is the larger of their margins, not the sum.
 */
export function collapseMargins(spaceAfter: number, spaceBefore: number): number {
  return Math.max(spaceAfter, spaceBefore);
}
